import {pool} from "../db/index.js";
import {ensureCourseGroupSchema} from "./courseGroupModel.js";
import {ensureRoleSchema, INSTRUCTOR_ROLE_ID, STUDENT_ROLE_ID} from "./roleModel.js";

export const CHAT_MESSAGE_MAX_LENGTH = 160;
export const CHAT_ALLOWED_EMOJIS = ["👍", "🎉", "😂", "❤️", "🔥", "👀", "✅", "❓", "💡", "🙌"];

let chatReadyPromise = null;

function normalizeText(value, maxLength = CHAT_MESSAGE_MAX_LENGTH) {
    const text = stripUnsupportedEmoji(String(value || "")).replace(/\s+/g, " ").trim();
    if (!text) return "";
    return text.slice(0, maxLength);
}

function stripUnsupportedEmoji(value) {
    let text = String(value || "");
    const placeholders = new Map();
    CHAT_ALLOWED_EMOJIS.forEach((emoji, index) => {
        const token = `__CHAT_ALLOWED_EMOJI_${index}__`;
        placeholders.set(token, emoji);
        text = text.split(emoji).join(token);
    });
    text = text.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "");
    placeholders.forEach((emoji, token) => {
        text = text.split(token).join(emoji);
    });
    return text;
}

function normalizeRoomName(value) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text.slice(0, 60);
}

function assertStudent(user) {
    return String(user?.role_id) === String(STUDENT_ROLE_ID);
}

function assertInstructor(user) {
    return String(user?.role_id) === String(INSTRUCTOR_ROLE_ID);
}

async function createChatSchema() {
    await ensureRoleSchema();
    await ensureCourseGroupSchema();

    await pool.query(`
        CREATE TABLE IF NOT EXISTS chat_rooms (
            chat_room_id SERIAL PRIMARY KEY,
            course_id INTEGER NOT NULL REFERENCES courses(course_id),
            course_group_id INTEGER REFERENCES course_groups(course_group_id),
            room_type TEXT NOT NULL CHECK (room_type IN ('broadcast', 'group')),
            room_name TEXT NOT NULL,
            created_by INTEGER REFERENCES users(user_id),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            deleted_at TIMESTAMPTZ
        )
    `);

    await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS chat_rooms_course_broadcast_idx
        ON chat_rooms (course_id)
        WHERE room_type = 'broadcast' AND deleted_at IS NULL
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS chat_rooms_course_group_idx
        ON chat_rooms (course_id, course_group_id, room_type)
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS chat_room_members (
            chat_room_id INTEGER NOT NULL REFERENCES chat_rooms(chat_room_id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
            last_read_at TIMESTAMPTZ NOT NULL DEFAULT 'epoch',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (chat_room_id, user_id)
        )
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS chat_room_members_user_idx
        ON chat_room_members (user_id)
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS chat_messages (
            chat_message_id SERIAL PRIMARY KEY,
            chat_room_id INTEGER NOT NULL REFERENCES chat_rooms(chat_room_id) ON DELETE CASCADE,
            sender_user_id INTEGER NOT NULL REFERENCES users(user_id),
            message_text TEXT NOT NULL CHECK (char_length(message_text) <= ${CHAT_MESSAGE_MAX_LENGTH}),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            deleted_at TIMESTAMPTZ
        )
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS chat_messages_room_idx
        ON chat_messages (chat_room_id, created_at DESC)
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS chat_message_reactions (
            chat_message_id INTEGER NOT NULL REFERENCES chat_messages(chat_message_id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
            emoji TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (chat_message_id, user_id, emoji)
        )
    `);

    await pool.query(`
        DELETE FROM chat_message_reactions old_reaction
        USING (
            SELECT ctid
            FROM (
                SELECT
                    ctid,
                    ROW_NUMBER() OVER (
                        PARTITION BY chat_message_id, user_id
                        ORDER BY created_at DESC, emoji ASC
                    ) AS row_number
                FROM chat_message_reactions
            ) ranked
            WHERE ranked.row_number > 1
        ) duplicate_reactions
        WHERE old_reaction.ctid = duplicate_reactions.ctid
    `);

    await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS chat_message_reactions_one_per_user_idx
        ON chat_message_reactions (chat_message_id, user_id)
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS chat_room_invites (
            chat_room_invite_id SERIAL PRIMARY KEY,
            chat_room_id INTEGER NOT NULL REFERENCES chat_rooms(chat_room_id) ON DELETE CASCADE,
            invited_user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
            invited_by_user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
            status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            responded_at TIMESTAMPTZ
        )
    `);

    await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS chat_room_invites_pending_idx
        ON chat_room_invites (chat_room_id, invited_user_id)
        WHERE status = 'pending'
    `);
}

export async function ensureChatSchema() {
    if (!chatReadyPromise) {
        chatReadyPromise = createChatSchema().catch((error) => {
            chatReadyPromise = null;
            throw error;
        });
    }
    return chatReadyPromise;
}

export async function getOrCreateBroadcastRoom(courseId, createdBy = null) {
    await ensureChatSchema();
    const existing = await pool.query(
        `SELECT *
         FROM chat_rooms
         WHERE course_id = $1
           AND room_type = 'broadcast'
           AND deleted_at IS NULL
         LIMIT 1`,
        [courseId]
    );
    if (existing.rows[0]) return existing.rows[0];

    const created = await pool.query(
        `INSERT INTO chat_rooms (course_id, room_type, room_name, created_by)
         VALUES ($1, 'broadcast', 'Announcements', $2)
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [courseId, createdBy]
    );
    if (created.rows[0]) return created.rows[0];
    return getOrCreateBroadcastRoom(courseId, createdBy);
}

async function syncBroadcastReadState(user) {
    const room = await getOrCreateBroadcastRoom(user.course_id);
    await pool.query(
        `INSERT INTO chat_room_members (chat_room_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [room.chat_room_id, user.user_id]
    );
    return room;
}

async function userCanAccessRoom(user, room) {
    if (!room || String(room.course_id) !== String(user.course_id)) return false;
    if (room.room_type === "broadcast") return true;
    if (assertInstructor(user)) return true;
    if (!assertStudent(user)) return false;
    const member = await pool.query(
        `SELECT 1
         FROM chat_room_members
         WHERE chat_room_id = $1
           AND user_id = $2
         LIMIT 1`,
        [room.chat_room_id, user.user_id]
    );
    return !!member.rows[0];
}

export async function getChatBootstrap(user) {
    await ensureChatSchema();
    await syncBroadcastReadState(user);
    const [broadcastMessages, rooms, students, invites] = await Promise.all([
        getMessagesForRoom(user, (await getOrCreateBroadcastRoom(user.course_id)).chat_room_id, {limit: 20}),
        listRoomsForUser(user),
        listAvailableStudents(user),
        listPendingInvites(user),
    ]);

    const unreadTotal = rooms.reduce((total, room) => total + Number(room.unread_count || 0), 0)
        + Number(broadcastMessages.unread_count || 0);

    return {
        max_message_length: CHAT_MESSAGE_MAX_LENGTH,
        allowed_emojis: CHAT_ALLOWED_EMOJIS,
        unread_total: unreadTotal,
        broadcast: broadcastMessages,
        rooms,
        available_students: students,
        pending_invites: invites,
    };
}

export async function listAvailableStudents(user) {
    await ensureChatSchema();
    if (!assertStudent(user) || !user.course_group_id) return [];
    const result = await pool.query(
        `SELECT user_id, name, email, NULL::text AS avatar_public_path
         FROM users
         WHERE course_id = $1
           AND course_group_id = $2
           AND role_id = $3
           AND user_id <> $4
           AND deleted_at IS NULL
           AND NOT EXISTS (
               SELECT 1
               FROM chat_room_members crm
               JOIN chat_rooms cr ON cr.chat_room_id = crm.chat_room_id
               WHERE crm.user_id = users.user_id
                 AND cr.course_id = users.course_id
                 AND cr.room_type = 'group'
                 AND cr.deleted_at IS NULL
           )
           AND NOT EXISTS (
               SELECT 1
               FROM chat_room_invites cri
               JOIN chat_rooms cr ON cr.chat_room_id = cri.chat_room_id
               WHERE cri.invited_user_id = users.user_id
                 AND cri.status = 'pending'
                 AND cr.course_id = users.course_id
                 AND cr.room_type = 'group'
                 AND cr.deleted_at IS NULL
           )
         ORDER BY name ASC`,
        [user.course_id, user.course_group_id, STUDENT_ROLE_ID, user.user_id]
    );
    return result.rows;
}

export async function listPendingInvites(user) {
    await ensureChatSchema();
    if (!assertStudent(user)) return [];
    const result = await pool.query(
        `SELECT
             cri.chat_room_invite_id,
             cri.chat_room_id,
             cr.room_name,
             cr.course_group_id,
             cg.group_name AS course_group_name,
             cri.invited_by_user_id,
             inviter.name AS invited_by_name,
             cri.created_at
         FROM chat_room_invites cri
         JOIN chat_rooms cr ON cr.chat_room_id = cri.chat_room_id
         LEFT JOIN course_groups cg ON cg.course_group_id = cr.course_group_id
         JOIN users inviter ON inviter.user_id = cri.invited_by_user_id
         WHERE cri.invited_user_id = $1
           AND cri.status = 'pending'
           AND cr.course_id = $2
           AND cr.deleted_at IS NULL
         ORDER BY cri.created_at DESC`,
        [user.user_id, user.course_id]
    );
    return result.rows;
}

export async function listRoomsForUser(user) {
    await ensureChatSchema();
    if (assertInstructor(user)) {
        const result = await pool.query(
            `SELECT
                 cr.chat_room_id,
                 cr.room_type,
                 cr.room_name,
                 cr.course_group_id,
                 cg.group_name AS course_group_name,
                 cr.created_by,
                 creator.name AS created_by_name,
                 cr.created_at,
                 COUNT(DISTINCT crm.user_id)::int AS member_count,
                 COALESCE(MAX(cm.created_at), cr.created_at) AS last_activity_at,
                 0::int AS unread_count
             FROM chat_rooms cr
             LEFT JOIN course_groups cg ON cg.course_group_id = cr.course_group_id
             LEFT JOIN users creator ON creator.user_id = cr.created_by
             LEFT JOIN chat_room_members crm ON crm.chat_room_id = cr.chat_room_id
             LEFT JOIN chat_messages cm ON cm.chat_room_id = cr.chat_room_id AND cm.deleted_at IS NULL
             WHERE cr.course_id = $1
               AND cr.room_type = 'group'
               AND cr.deleted_at IS NULL
             GROUP BY cr.chat_room_id, cg.group_name, creator.name
             ORDER BY last_activity_at DESC, cr.created_at DESC`,
            [user.course_id]
        );
        return result.rows;
    }

    if (!assertStudent(user)) return [];
    const result = await pool.query(
        `SELECT
             cr.chat_room_id,
             cr.room_type,
             cr.room_name,
             cr.course_group_id,
             cg.group_name AS course_group_name,
             cr.created_by,
             creator.name AS created_by_name,
             cr.created_at,
             COUNT(DISTINCT all_members.user_id)::int AS member_count,
             COALESCE(MAX(cm.created_at), cr.created_at) AS last_activity_at,
             (
                 CASE
                     WHEN cr.created_at > mine.last_read_at
                      AND cr.created_by <> $2 THEN 1
                     ELSE 0
                 END
                 + (
                     COUNT(cm.chat_message_id) FILTER (
                         WHERE cm.created_at > mine.last_read_at
                           AND cm.sender_user_id <> $2
                     )
                 )::int
             ) AS unread_count
         FROM chat_room_members mine
         JOIN chat_rooms cr ON cr.chat_room_id = mine.chat_room_id
         LEFT JOIN course_groups cg ON cg.course_group_id = cr.course_group_id
         LEFT JOIN users creator ON creator.user_id = cr.created_by
         LEFT JOIN chat_room_members all_members ON all_members.chat_room_id = cr.chat_room_id
         LEFT JOIN chat_messages cm ON cm.chat_room_id = cr.chat_room_id AND cm.deleted_at IS NULL
         WHERE mine.user_id = $2
           AND cr.course_id = $1
           AND cr.room_type = 'group'
           AND cr.deleted_at IS NULL
         GROUP BY cr.chat_room_id, cg.group_name, creator.name, mine.last_read_at
         ORDER BY last_activity_at DESC, cr.created_at DESC`,
        [user.course_id, user.user_id]
    );
    return result.rows;
}

export async function createStudentGroupRoom(user, payload) {
    await ensureChatSchema();
    if (!assertStudent(user) || !user.course_group_id) {
        const error = new Error("Only students with a course group can create group chats.");
        error.status = 403;
        throw error;
    }

    const existingMembership = await pool.query(
        `SELECT cr.chat_room_id
         FROM chat_room_members crm
         JOIN chat_rooms cr ON cr.chat_room_id = crm.chat_room_id
         WHERE crm.user_id = $1
           AND cr.course_id = $2
           AND cr.room_type = 'group'
           AND cr.deleted_at IS NULL
         LIMIT 1`,
        [user.user_id, user.course_id]
    );
    if (existingMembership.rows[0]) {
        const error = new Error("Exit your current group chat before creating a new one.");
        error.status = 409;
        throw error;
    }

    const rawMemberIds = Array.isArray(payload?.member_ids) ? payload.member_ids : [];
    const memberIds = [...new Set(rawMemberIds.map((id) => Number.parseInt(id, 10)).filter(Number.isFinite))];
    if (memberIds.length < 1) {
        const error = new Error("Choose at least one classmate.");
        error.status = 400;
        throw error;
    }

    const members = await pool.query(
        `SELECT user_id, name
         FROM users
         WHERE course_id = $1
           AND course_group_id = $2
           AND role_id = $3
           AND user_id = ANY($4::int[])
           AND deleted_at IS NULL`,
        [user.course_id, user.course_group_id, STUDENT_ROLE_ID, memberIds]
    );

    if (members.rows.length !== memberIds.length) {
        const error = new Error("Students must be in your own group.");
        error.status = 403;
        throw error;
    }

    const busyMembers = await pool.query(
        `SELECT u.name
         FROM chat_room_members crm
         JOIN chat_rooms cr ON cr.chat_room_id = crm.chat_room_id
         JOIN users u ON u.user_id = crm.user_id
         WHERE crm.user_id = ANY($1::int[])
           AND cr.course_id = $2
           AND cr.room_type = 'group'
           AND cr.deleted_at IS NULL
         ORDER BY u.name ASC`,
        [memberIds, user.course_id]
    );
    if (busyMembers.rows.length > 0) {
        const error = new Error(`${busyMembers.rows[0].name} is already in a group chat.`);
        error.status = 409;
        throw error;
    }

    const roomName = normalizeRoomName(payload?.room_name)
        || [user.name, ...members.rows.map((member) => member.name)].slice(0, 4).join(", ");

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const roomResult = await client.query(
            `INSERT INTO chat_rooms (course_id, course_group_id, room_type, room_name, created_by)
             VALUES ($1, $2, 'group', $3, $4)
             RETURNING *`,
            [user.course_id, user.course_group_id, roomName, user.user_id]
        );
        const room = roomResult.rows[0];
        const allMemberIds = [user.user_id, ...memberIds];
        for (const memberId of allMemberIds) {
            await client.query(
                `INSERT INTO chat_room_members (chat_room_id, user_id, last_read_at)
                 VALUES ($1, $2, CASE WHEN $2::int = $3::int THEN NOW() ELSE 'epoch'::timestamptz END)
                 ON CONFLICT DO NOTHING`,
                [room.chat_room_id, memberId, user.user_id]
            );
        }
        await client.query("COMMIT");
        return room;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function leaveStudentGroupRoom(user, roomId) {
    await ensureChatSchema();
    if (!assertStudent(user)) {
        const error = new Error("Only students can exit group chats.");
        error.status = 403;
        throw error;
    }

    const room = await findRoomForUser(user, roomId);
    if (room.room_type !== "group") {
        const error = new Error("Only group chats can be exited.");
        error.status = 400;
        throw error;
    }

    const removed = await pool.query(
        `DELETE FROM chat_room_members
         WHERE chat_room_id = $1
           AND user_id = $2
         RETURNING user_id`,
        [room.chat_room_id, user.user_id]
    );
    if (!removed.rows[0]) {
        const error = new Error("You are not a member of this group chat.");
        error.status = 404;
        throw error;
    }

    const remaining = await pool.query(
        `SELECT COUNT(*)::int AS member_count
         FROM chat_room_members
         WHERE chat_room_id = $1`,
        [room.chat_room_id]
    );
    if ((remaining.rows[0]?.member_count || 0) === 0) {
        await pool.query(
            `UPDATE chat_rooms
             SET deleted_at = NOW(), updated_at = NOW()
             WHERE chat_room_id = $1`,
            [room.chat_room_id]
        );
    }

    return {room, member_count: remaining.rows[0]?.member_count || 0};
}

export async function inviteStudentToGroupRoom(user, roomId, invitedUserId) {
    await ensureChatSchema();
    if (!assertStudent(user)) {
        const error = new Error("Only students can invite classmates.");
        error.status = 403;
        throw error;
    }

    const room = await findRoomForUser(user, roomId);
    if (room.room_type !== "group") {
        const error = new Error("Invites are only available for group chats.");
        error.status = 400;
        throw error;
    }

    const targetUserId = Number.parseInt(invitedUserId, 10);
    if (!Number.isFinite(targetUserId) || targetUserId <= 0 || String(targetUserId) === String(user.user_id)) {
        const error = new Error("Choose a valid classmate.");
        error.status = 400;
        throw error;
    }

    const target = await pool.query(
        `SELECT user_id, name, course_id, course_group_id, role_id
         FROM users
         WHERE user_id = $1
           AND deleted_at IS NULL
         LIMIT 1`,
        [targetUserId]
    );
    const student = target.rows[0];
    if (
        !student
        || String(student.course_id) !== String(user.course_id)
        || String(student.course_group_id) !== String(user.course_group_id)
        || String(student.role_id) !== String(STUDENT_ROLE_ID)
    ) {
        const error = new Error("Students must be in your own group.");
        error.status = 403;
        throw error;
    }

    const existingMembership = await pool.query(
        `SELECT 1
         FROM chat_room_members crm
         JOIN chat_rooms cr ON cr.chat_room_id = crm.chat_room_id
         WHERE crm.user_id = $1
           AND cr.course_id = $2
           AND cr.room_type = 'group'
           AND cr.deleted_at IS NULL
         LIMIT 1`,
        [student.user_id, user.course_id]
    );
    if (existingMembership.rows[0]) {
        const error = new Error(`${student.name} is already in a group chat.`);
        error.status = 409;
        throw error;
    }

    const existingInvite = await pool.query(
        `SELECT chat_room_invite_id
         FROM chat_room_invites
         WHERE chat_room_id = $1
           AND invited_user_id = $2
           AND status = 'pending'
         LIMIT 1`,
        [room.chat_room_id, student.user_id]
    );
    if (existingInvite.rows[0]) {
        return {
            invite_id: existingInvite.rows[0].chat_room_invite_id,
            room,
            invited_user_id: student.user_id,
        };
    }

    const result = await pool.query(
        `INSERT INTO chat_room_invites (chat_room_id, invited_user_id, invited_by_user_id)
         VALUES ($1, $2, $3)
         RETURNING chat_room_invite_id`,
        [room.chat_room_id, student.user_id, user.user_id]
    );

    return {
        invite_id: result.rows[0].chat_room_invite_id,
        room,
        invited_user_id: student.user_id,
    };
}

export async function respondToGroupInvite(user, inviteId, action) {
    await ensureChatSchema();
    if (!assertStudent(user)) {
        const error = new Error("Only students can respond to chat invites.");
        error.status = 403;
        throw error;
    }

    const normalizedAction = action === "accept" ? "accepted" : action === "decline" ? "declined" : "";
    if (!normalizedAction) {
        const error = new Error("Choose accept or decline.");
        error.status = 400;
        throw error;
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const inviteResult = await client.query(
            `SELECT cri.*, cr.course_id, cr.course_group_id, cr.room_type, cr.room_name, cr.deleted_at
             FROM chat_room_invites cri
             JOIN chat_rooms cr ON cr.chat_room_id = cri.chat_room_id
             WHERE cri.chat_room_invite_id = $1
               AND cri.invited_user_id = $2
               AND cri.status = 'pending'
             FOR UPDATE`,
            [inviteId, user.user_id]
        );
        const invite = inviteResult.rows[0];
        if (!invite || invite.deleted_at || invite.room_type !== "group") {
            const error = new Error("Invite not found.");
            error.status = 404;
            throw error;
        }
        if (
            String(invite.course_id) !== String(user.course_id)
            || String(invite.course_group_id) !== String(user.course_group_id)
        ) {
            const error = new Error("Invite is not for your group.");
            error.status = 403;
            throw error;
        }

        if (normalizedAction === "accepted") {
            const existingMembership = await client.query(
                `SELECT 1
                 FROM chat_room_members crm
                 JOIN chat_rooms cr ON cr.chat_room_id = crm.chat_room_id
                 WHERE crm.user_id = $1
                   AND cr.course_id = $2
                   AND cr.room_type = 'group'
                   AND cr.deleted_at IS NULL
                 LIMIT 1`,
                [user.user_id, user.course_id]
            );
            if (existingMembership.rows[0]) {
                const error = new Error("Exit your current group chat before accepting an invite.");
                error.status = 409;
                throw error;
            }
            await client.query(
                `INSERT INTO chat_room_members (chat_room_id, user_id, last_read_at)
                 VALUES ($1, $2, NOW())
                 ON CONFLICT (chat_room_id, user_id)
                 DO UPDATE SET last_read_at = NOW()`,
                [invite.chat_room_id, user.user_id]
            );
        }

        await client.query(
            `UPDATE chat_room_invites
             SET status = $2,
                 responded_at = NOW()
             WHERE chat_room_invite_id = $1`,
            [invite.chat_room_invite_id, normalizedAction]
        );
        await client.query("COMMIT");

        return {
            room: {
                chat_room_id: invite.chat_room_id,
                course_id: invite.course_id,
                course_group_id: invite.course_group_id,
                room_type: invite.room_type,
                room_name: invite.room_name,
            },
            status: normalizedAction,
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function findRoomForUser(user, roomId) {
    await ensureChatSchema();
    const result = await pool.query(
        `SELECT *
         FROM chat_rooms
         WHERE chat_room_id = $1
           AND deleted_at IS NULL
         LIMIT 1`,
        [roomId]
    );
    const room = result.rows[0];
    if (!(await userCanAccessRoom(user, room))) {
        const error = new Error("Chat room not found.");
        error.status = 404;
        throw error;
    }
    return room;
}

export async function getMessagesForRoom(user, roomId, options = {}) {
    const room = await findRoomForUser(user, roomId);
    const limit = Math.min(Math.max(Number.parseInt(options.limit, 10) || 50, 1), 100);

    const [messagesResult, membersResult, readResult] = await Promise.all([
        pool.query(
            `SELECT
                 cm.chat_message_id,
                 cm.chat_room_id,
                 cm.sender_user_id,
                 sender.name AS sender_name,
                 NULL::text AS avatar_public_path,
                 cm.message_text,
                 cm.created_at,
                 COALESCE(
                     json_agg(
                         json_build_object(
                             'emoji', reaction_counts.emoji,
                             'count', reaction_counts.reaction_count,
                             'reacted_by_me', COALESCE(my_reactions.user_id IS NOT NULL, FALSE)
                         )
                         ORDER BY reaction_counts.emoji
                     ) FILTER (WHERE reaction_counts.emoji IS NOT NULL),
                     '[]'::json
                 ) AS reactions
             FROM (
                 SELECT *
                 FROM chat_messages
                 WHERE chat_room_id = $1
                   AND deleted_at IS NULL
                 ORDER BY created_at DESC
                 LIMIT $2
             ) cm
             JOIN users sender ON sender.user_id = cm.sender_user_id
             LEFT JOIN (
                 SELECT chat_message_id, emoji, COUNT(*)::int AS reaction_count
                 FROM chat_message_reactions
                 WHERE chat_message_id IN (
                     SELECT chat_message_id
                     FROM chat_messages
                     WHERE chat_room_id = $1
                       AND deleted_at IS NULL
                     ORDER BY created_at DESC
                     LIMIT $2
                 )
                 GROUP BY chat_message_id, emoji
             ) reaction_counts ON reaction_counts.chat_message_id = cm.chat_message_id
             LEFT JOIN chat_message_reactions my_reactions
                    ON my_reactions.chat_message_id = cm.chat_message_id
                   AND my_reactions.emoji = reaction_counts.emoji
                   AND my_reactions.user_id = $3
             GROUP BY cm.chat_message_id, cm.chat_room_id, cm.sender_user_id, sender.name, cm.message_text, cm.created_at
             ORDER BY cm.created_at ASC`,
            [room.chat_room_id, limit, user.user_id]
        ),
        pool.query(
            `SELECT u.user_id, u.name, NULL::text AS avatar_public_path
             FROM chat_room_members crm
             JOIN users u ON u.user_id = crm.user_id
             WHERE crm.chat_room_id = $1
             ORDER BY u.name ASC`,
            [room.chat_room_id]
        ),
        pool.query(
            `SELECT COUNT(cm.chat_message_id)::int AS unread_count
             FROM chat_room_members crm
             JOIN chat_messages cm ON cm.chat_room_id = crm.chat_room_id
             WHERE crm.chat_room_id = $1
               AND crm.user_id = $2
               AND cm.deleted_at IS NULL
               AND cm.created_at > crm.last_read_at
               AND cm.sender_user_id <> $2`,
            [room.chat_room_id, user.user_id]
        ),
    ]);

    return {
        room,
        members: membersResult.rows,
        messages: messagesResult.rows,
        unread_count: readResult.rows[0]?.unread_count || 0,
    };
}

export async function addMessageToRoom(user, roomId, messageText) {
    const room = await findRoomForUser(user, roomId);
    if (room.room_type === "broadcast" && !assertInstructor(user)) {
        const error = new Error("Only instructors can send broadcasts.");
        error.status = 403;
        throw error;
    }
    if (room.room_type === "group" && assertInstructor(user)) {
        const error = new Error("Instructor inspection is read-only.");
        error.status = 403;
        throw error;
    }

    const text = normalizeText(messageText);
    if (!text) {
        const error = new Error("Message cannot be empty.");
        error.status = 400;
        throw error;
    }

    const result = await pool.query(
        `INSERT INTO chat_messages (chat_room_id, sender_user_id, message_text)
         VALUES ($1, $2, $3)
         RETURNING chat_message_id`,
        [room.chat_room_id, user.user_id, text]
    );
    await pool.query(
        `UPDATE chat_room_members
         SET last_read_at = NOW()
         WHERE chat_room_id = $1
           AND user_id = $2`,
        [room.chat_room_id, user.user_id]
    );
    return getMessagesForRoom(user, room.chat_room_id, {limit: 1}).then((data) =>
        data.messages.find((message) => String(message.chat_message_id) === String(result.rows[0].chat_message_id))
    );
}

export async function markRoomRead(user, roomId) {
    const room = await findRoomForUser(user, roomId);
    await pool.query(
        `INSERT INTO chat_room_members (chat_room_id, user_id, last_read_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (chat_room_id, user_id)
         DO UPDATE SET last_read_at = NOW()`,
        [room.chat_room_id, user.user_id]
    );
    return {ok: true};
}

export async function toggleReaction(user, messageId, emoji) {
    await ensureChatSchema();
    if (!CHAT_ALLOWED_EMOJIS.includes(emoji)) {
        const error = new Error("Emoji is not allowed.");
        error.status = 400;
        throw error;
    }

    const messageResult = await pool.query(
        `SELECT cm.chat_message_id, cm.chat_room_id
         FROM chat_messages cm
         WHERE cm.chat_message_id = $1
           AND cm.deleted_at IS NULL
         LIMIT 1`,
        [messageId]
    );
    const message = messageResult.rows[0];
    if (!message) {
        const error = new Error("Message not found.");
        error.status = 404;
        throw error;
    }
    await findRoomForUser(user, message.chat_room_id);

    const existing = await pool.query(
        `SELECT emoji
         FROM chat_message_reactions
         WHERE chat_message_id = $1
           AND user_id = $2
         LIMIT 1`,
        [message.chat_message_id, user.user_id]
    );

    if (existing.rows[0]?.emoji === emoji) {
        await pool.query(
            `DELETE FROM chat_message_reactions
             WHERE chat_message_id = $1
               AND user_id = $2`,
            [message.chat_message_id, user.user_id]
        );
        return {reacted: false, room_id: message.chat_room_id};
    }

    await pool.query(
        `DELETE FROM chat_message_reactions
         WHERE chat_message_id = $1
           AND user_id = $2`,
        [message.chat_message_id, user.user_id]
    );

    await pool.query(
        `INSERT INTO chat_message_reactions (chat_message_id, user_id, emoji)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [message.chat_message_id, user.user_id, emoji]
    );
    return {reacted: true, room_id: message.chat_room_id};
}
