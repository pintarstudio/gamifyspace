import {findSession} from "../models/sessionModel.js";
import {
    addMessageToRoom,
    createStudentGroupRoom,
    getChatBootstrap,
    getMessagesForRoom,
    getOrCreateBroadcastRoom,
    inviteStudentToGroupRoom,
    leaveStudentGroupRoom,
    markRoomRead,
    respondToGroupInvite,
    toggleReaction,
} from "../models/chatModel.js";

async function getAuthenticatedUser(req, res) {
    const sessionId = req.session?.session_id;
    if (!sessionId) {
        res.status(401).json({message: "Sesi tidak ditemukan"});
        return null;
    }

    const user = await findSession(sessionId);
    if (!user) {
        res.status(401).json({message: "Sesi tidak valid"});
        return null;
    }
    return user;
}

function handleChatError(res, error) {
    console.error("Chat error:", error);
    res.status(error.status || 500).json({message: error.message || "Gagal memproses chat"});
}

function chatCourseRoom(courseId) {
    return `chat:course:${courseId}`;
}

function chatUserRoom(userId) {
    return `chat:user:${userId}`;
}

function chatRoom(roomId) {
    return `chat:room:${roomId}`;
}

function emitChatEvent(req, rooms, eventName, payload) {
    const io = req.app.get("io");
    if (!io) return;
    [...new Set(rooms.filter(Boolean))].forEach((room) => {
        io.to(room).emit(eventName, payload);
    });
}

function emitRoomChange(req, user, roomData, eventName, extra = {}) {
    const room = roomData?.room;
    if (!room) return;
    const rooms = [
        chatCourseRoom(user.course_id),
        chatRoom(room.chat_room_id),
        ...(roomData.members || []).map((member) => chatUserRoom(member.user_id)),
    ];
    emitChatEvent(req, rooms, eventName, {
        room_id: room.chat_room_id,
        course_id: user.course_id,
        ...extra,
    });
}

export async function getBootstrap(req, res) {
    try {
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;
        const data = await getChatBootstrap(user);
        res.json(data);
    } catch (error) {
        handleChatError(res, error);
    }
}

export async function createRoom(req, res) {
    try {
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;
        const room = await createStudentGroupRoom(user, req.body);
        const data = await getMessagesForRoom(user, room.chat_room_id);
        emitRoomChange(req, user, data, "chat:room:new", {
            room_name: data.room.room_name,
            created_by_user_id: user.user_id,
            created_by_name: user.name,
        });
        res.status(201).json(data);
    } catch (error) {
        handleChatError(res, error);
    }
}

export async function getRoomMessages(req, res) {
    try {
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;
        const data = await getMessagesForRoom(user, req.params.roomId);
        res.json(data);
    } catch (error) {
        handleChatError(res, error);
    }
}

export async function sendRoomMessage(req, res) {
    try {
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;
        const message = await addMessageToRoom(user, req.params.roomId, req.body?.message_text);
        const data = await getMessagesForRoom(user, req.params.roomId);
        emitRoomChange(req, user, data, "chat:message:new", {
            message,
            room_name: data.room.room_name,
        });
        res.status(201).json({message});
    } catch (error) {
        handleChatError(res, error);
    }
}

export async function sendBroadcast(req, res) {
    try {
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;
        const room = await getOrCreateBroadcastRoom(user.course_id, user.user_id);
        const message = await addMessageToRoom(user, room.chat_room_id, req.body?.message_text);
        emitChatEvent(req, [chatCourseRoom(user.course_id), chatRoom(room.chat_room_id)], "chat:message:new", {
            room_id: room.chat_room_id,
            room_name: room.room_name,
            course_id: user.course_id,
            message,
        });
        res.status(201).json({message, room_id: room.chat_room_id});
    } catch (error) {
        handleChatError(res, error);
    }
}

export async function readRoom(req, res) {
    try {
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;
        await markRoomRead(user, req.params.roomId);
        res.json({ok: true});
    } catch (error) {
        handleChatError(res, error);
    }
}

export async function reactToMessage(req, res) {
    try {
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;
        const result = await toggleReaction(user, req.params.messageId, req.body?.emoji);
        emitChatEvent(req, [chatCourseRoom(user.course_id), chatRoom(result.room_id)], "chat:reaction:update", {
            room_id: result.room_id,
            course_id: user.course_id,
            message_id: req.params.messageId,
        });
        res.json(result);
    } catch (error) {
        handleChatError(res, error);
    }
}

export async function leaveRoom(req, res) {
    try {
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;
        const result = await leaveStudentGroupRoom(user, req.params.roomId);
        emitChatEvent(req, [
            chatCourseRoom(user.course_id),
            chatRoom(result.room.chat_room_id),
            chatUserRoom(user.user_id),
        ], "chat:room:left", {
            room_id: result.room.chat_room_id,
            room_name: result.room.room_name,
            course_id: user.course_id,
            user_id: user.user_id,
            user_name: user.name,
            member_count: result.member_count,
        });
        res.json({ok: true});
    } catch (error) {
        handleChatError(res, error);
    }
}

export async function inviteToRoom(req, res) {
    try {
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;
        const result = await inviteStudentToGroupRoom(user, req.params.roomId, req.body?.user_id);
        emitChatEvent(req, [
            chatRoom(result.room.chat_room_id),
            chatUserRoom(result.invited_user_id),
        ], "chat:invite:new", {
            invite_id: result.invite_id,
            room_id: result.room.chat_room_id,
            room_name: result.room.room_name,
            course_id: user.course_id,
            invited_user_id: result.invited_user_id,
            invited_by_user_id: user.user_id,
            invited_by_name: user.name,
        });
        res.status(201).json({ok: true, invite_id: result.invite_id});
    } catch (error) {
        handleChatError(res, error);
    }
}

export async function respondInvite(req, res) {
    try {
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;
        const result = await respondToGroupInvite(user, req.params.inviteId, req.body?.action);
        const eventName = result.status === "accepted" ? "chat:invite:accepted" : "chat:invite:declined";
        emitChatEvent(req, [
            chatRoom(result.room.chat_room_id),
            chatUserRoom(user.user_id),
        ], eventName, {
            invite_id: req.params.inviteId,
            room_id: result.room.chat_room_id,
            room_name: result.room.room_name,
            course_id: user.course_id,
            user_id: user.user_id,
            user_name: user.name,
        });
        res.json({ok: true, status: result.status, room_id: result.room.chat_room_id});
    } catch (error) {
        handleChatError(res, error);
    }
}
