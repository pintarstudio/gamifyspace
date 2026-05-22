import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {apiGet, apiPost} from "../api/apiClient";
import socket from "../utils/socketClient";
import "./ChatLauncher.css";

const INSTRUCTOR_ROLE_ID = 2;
const POLL_MS = 30000;
const CHAT_UNAVAILABLE_MESSAGE = "Chat is unavailable. Please restart the backend and try again.";

function formatTime(value, {withDate = false} = {}) {
    if (!value) return "";
    const date = new Date(value);
    const timeText = date.toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"});
    if (!withDate) return timeText;
    const dateText = date.toLocaleDateString("en-US", {weekday: "short", day: "2-digit", month: "short"});
    return `${dateText} ${timeText}`;
}

function getErrorMessage(data, fallback) {
    return data?.message || fallback;
}

function stripUnsupportedEmoji(value, allowedEmojis) {
    let text = String(value || "");
    const placeholders = new Map();
    allowedEmojis.forEach((emoji, index) => {
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

const emptyBootstrap = {
    allowed_emojis: [],
    max_message_length: 160,
    unread_total: 0,
    broadcast: {room: null, messages: [], unread_count: 0},
    rooms: [],
    available_students: [],
    pending_invites: [],
};

async function safeApiGet(path) {
    try {
        return await apiGet(path);
    } catch (error) {
        return {message: CHAT_UNAVAILABLE_MESSAGE};
    }
}

async function safeApiPost(path, data) {
    try {
        return await apiPost(path, data);
    } catch (error) {
        return {message: CHAT_UNAVAILABLE_MESSAGE};
    }
}

export default function ChatLauncher({currentUser}) {
    const [open, setOpen] = useState(false);
    const [activeTab, setActiveTab] = useState(() =>
        String(currentUser?.role_id) === String(INSTRUCTOR_ROLE_ID) ? "announcements" : "groups"
    );
    const [bootstrap, setBootstrap] = useState(emptyBootstrap);
    const [selectedRoomId, setSelectedRoomId] = useState(null);
    const [roomData, setRoomData] = useState(null);
    const [messageText, setMessageText] = useState("");
    const [broadcastText, setBroadcastText] = useState("");
    const [roomName, setRoomName] = useState("");
    const [selectedMembers, setSelectedMembers] = useState([]);
    const [creatingRoom, setCreatingRoom] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [toast, setToast] = useState("");
    const [reactionPickerId, setReactionPickerId] = useState(null);
    const [confirmLeaveRoomId, setConfirmLeaveRoomId] = useState(null);
    const [invitePanelOpen, setInvitePanelOpen] = useState(false);
    const [inviteUserId, setInviteUserId] = useState("");
    const lastUnreadRef = useRef(null);
    const toastTimerRef = useRef(null);

    const isInstructor = String(currentUser?.role_id) === String(INSTRUCTOR_ROLE_ID);
    const maxLength = bootstrap.max_message_length || 160;
    const allowedEmojis = bootstrap.allowed_emojis || [];
    const broadcastRoomId = bootstrap.broadcast?.room?.chat_room_id;
    const selectedRoom = bootstrap.rooms.find((room) => String(room.chat_room_id) === String(selectedRoomId));
    const unreadTotal = Number(bootstrap.unread_total || 0);
    const hasGroupRoom = bootstrap.rooms.length > 0;
    const pendingInvites = bootstrap.pending_invites || [];

    const updateText = (value, setter) => {
        setter(stripUnsupportedEmoji(value, allowedEmojis).slice(0, maxLength));
    };

    const appendEmoji = (current, setter, emoji) => {
        updateText(`${current}${emoji}`, setter);
    };

    const showToast = useCallback((text) => {
        setToast(text);
        if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = window.setTimeout(() => setToast(""), 3600);
    }, []);

    const loadBootstrap = useCallback(async ({silent = false} = {}) => {
        if (!currentUser?.user_id) return;
        if (!silent) setLoading(true);
        const data = await safeApiGet("/chat/bootstrap");
        if (data?.message) {
            setError(data.message);
            if (!silent) showToast(data.message);
        } else {
            setError("");
            setBootstrap({
                ...emptyBootstrap,
                ...data,
                broadcast: data.broadcast || emptyBootstrap.broadcast,
                rooms: data.rooms || [],
                available_students: data.available_students || [],
                pending_invites: data.pending_invites || [],
            });

            lastUnreadRef.current = Number(data.unread_total || 0);
        }
        if (!silent) setLoading(false);
    }, [currentUser?.user_id, showToast]);

    const loadRoom = useCallback(async (roomId) => {
        if (!roomId) {
            setRoomData(null);
            return;
        }
        const data = await safeApiGet(`/chat/rooms/${roomId}/messages`);
        if (data?.message) {
            setError(data.message);
            showToast(data.message);
            return;
        }
        setError("");
        setRoomData(data);
    }, [showToast]);

    const markRead = useCallback(async (roomId) => {
        if (!roomId) return;
        await safeApiPost(`/chat/rooms/${roomId}/read`, {});
        loadBootstrap({silent: true});
    }, [loadBootstrap]);

    useEffect(() => {
        loadBootstrap();
        const intervalId = window.setInterval(() => loadBootstrap({silent: true}), POLL_MS);
        return () => {
            window.clearInterval(intervalId);
            if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
        };
    }, [loadBootstrap]);

    useEffect(() => {
        setActiveTab(isInstructor ? "announcements" : "groups");
    }, [isInstructor]);

    useEffect(() => {
        if (selectedRoomId) return;
        const firstRoom = bootstrap.rooms[0];
        if (firstRoom) setSelectedRoomId(firstRoom.chat_room_id);
    }, [bootstrap.rooms, selectedRoomId]);

    useEffect(() => {
        if (!open) return;
        if (activeTab === "announcements" && broadcastRoomId) markRead(broadcastRoomId);
        if (activeTab === "groups" && selectedRoomId) {
            loadRoom(selectedRoomId);
            markRead(selectedRoomId);
        }
    }, [activeTab, broadcastRoomId, loadRoom, markRead, open, selectedRoomId]);

    useEffect(() => {
        if (!currentUser?.user_id || !currentUser?.course_id) return undefined;

        socket.emit("chat:join", {
            user_id: currentUser.user_id,
            course_id: currentUser.course_id,
            room_ids: [
                bootstrap.broadcast?.room?.chat_room_id,
                ...bootstrap.rooms.map((room) => room.chat_room_id),
            ].filter(Boolean),
        });
        bootstrap.rooms.forEach((room) => socket.emit("chat:join_room", {room_id: room.chat_room_id}));

        const roomLabel = (event) => {
            if (event.room_name) return event.room_name;
            const eventRoomId = event.room_id ? String(event.room_id) : "";
            return bootstrap.rooms.find((room) => String(room.chat_room_id) === eventRoomId)?.room_name || "Group chat";
        };

        const notifyForChatEvent = (eventName, event = {}) => {
            if (eventName === "chat:reaction:update") return;
            if (eventName === "chat:message:new") {
                if (String(event.message?.sender_user_id) === String(currentUser.user_id)) return;
                if (broadcastRoomId && String(event.room_id) === String(broadcastRoomId)) {
                    showToast("New announcement from instructor");
                    return;
                }
                showToast(`New message in ${roomLabel(event)}`);
                return;
            }
            if (eventName === "chat:invite:new") {
                if (String(event.invited_user_id) === String(currentUser.user_id)) {
                    showToast(`You were invited to ${roomLabel(event)}`);
                }
                return;
            }
            if (eventName === "chat:room:left") {
                if (String(event.user_id) !== String(currentUser.user_id)) {
                    showToast(`${event.user_name || "A student"} left ${roomLabel(event)}`);
                }
                return;
            }
            if (eventName === "chat:room:new") {
                if (String(event.created_by_user_id) !== String(currentUser.user_id)) {
                    showToast(`You joined ${roomLabel(event)}`);
                }
                return;
            }
            if (eventName === "chat:invite:accepted") {
                if (String(event.user_id) !== String(currentUser.user_id)) {
                    showToast(`${event.user_name || "A student"} joined ${roomLabel(event)}`);
                }
                return;
            }
            if (eventName === "chat:invite:declined") {
                if (String(event.user_id) !== String(currentUser.user_id)) {
                    showToast(`${event.user_name || "A student"} declined the invite`);
                }
            }
        };

        const handleChatEvent = (eventName, event = {}) => {
            loadBootstrap({silent: true});
            const eventRoomId = event.room_id ? String(event.room_id) : "";
            const activeRoomId = selectedRoomId ? String(selectedRoomId) : "";
            if (activeTab === "groups" && activeRoomId && eventRoomId === activeRoomId) {
                loadRoom(selectedRoomId);
                if (open) markRead(selectedRoomId);
            }
            if (activeTab === "announcements" && broadcastRoomId && eventRoomId === String(broadcastRoomId)) {
                if (open) markRead(broadcastRoomId);
            }
            notifyForChatEvent(eventName, event);
        };

        const messageHandler = (event) => handleChatEvent("chat:message:new", event);
        const reactionHandler = (event) => handleChatEvent("chat:reaction:update", event);
        const roomNewHandler = (event) => handleChatEvent("chat:room:new", event);
        const roomLeftHandler = (event) => handleChatEvent("chat:room:left", event);
        const inviteNewHandler = (event) => handleChatEvent("chat:invite:new", event);
        const inviteAcceptedHandler = (event) => handleChatEvent("chat:invite:accepted", event);
        const inviteDeclinedHandler = (event) => handleChatEvent("chat:invite:declined", event);

        socket.on("chat:message:new", messageHandler);
        socket.on("chat:reaction:update", reactionHandler);
        socket.on("chat:room:new", roomNewHandler);
        socket.on("chat:room:left", roomLeftHandler);
        socket.on("chat:invite:new", inviteNewHandler);
        socket.on("chat:invite:accepted", inviteAcceptedHandler);
        socket.on("chat:invite:declined", inviteDeclinedHandler);

        return () => {
            socket.off("chat:message:new", messageHandler);
            socket.off("chat:reaction:update", reactionHandler);
            socket.off("chat:room:new", roomNewHandler);
            socket.off("chat:room:left", roomLeftHandler);
            socket.off("chat:invite:new", inviteNewHandler);
            socket.off("chat:invite:accepted", inviteAcceptedHandler);
            socket.off("chat:invite:declined", inviteDeclinedHandler);
        };
    }, [
        activeTab,
        bootstrap.broadcast?.room?.chat_room_id,
        bootstrap.rooms,
        broadcastRoomId,
        currentUser?.course_id,
        currentUser?.user_id,
        currentUser?.name,
        loadBootstrap,
        loadRoom,
        markRead,
        open,
        selectedRoomId,
        showToast,
    ]);

    const tabs = useMemo(() => {
        if (isInstructor) {
            return [
                {id: "announcements", label: "Broadcast"},
                {id: "groups", label: "Inspect"},
            ];
        }
        return [
            {id: "announcements", label: "Announcements"},
            {id: "groups", label: "Group Chats"},
        ];
    }, [isInstructor]);

    const refreshActive = async () => {
        await loadBootstrap({silent: true});
        if (activeTab === "groups" && selectedRoomId) await loadRoom(selectedRoomId);
    };

    const sendBroadcast = async () => {
        const text = broadcastText.trim();
        if (!text) return;
        const data = await safeApiPost("/chat/broadcast", {message_text: text});
        if (data?.message && !data.message.chat_message_id) {
            showToast(getErrorMessage(data, "Broadcast failed"));
            return;
        }
        setBroadcastText("");
        showToast("Broadcast sent");
        refreshActive();
    };

    const sendMessage = async () => {
        const text = messageText.trim();
        if (!text || !selectedRoomId) return;
        const data = await safeApiPost(`/chat/rooms/${selectedRoomId}/messages`, {message_text: text});
        if (data?.message && !data.message.chat_message_id) {
            showToast(getErrorMessage(data, "Message failed"));
            return;
        }
        setMessageText("");
        await loadRoom(selectedRoomId);
        await loadBootstrap({silent: true});
    };

    const createRoom = async () => {
        if (selectedMembers.length < 1) {
            showToast("Choose at least one classmate");
            return;
        }
        const data = await safeApiPost("/chat/rooms", {
            room_name: roomName,
            member_ids: selectedMembers,
        });
        if (data?.message) {
            showToast(getErrorMessage(data, "Could not create chat"));
            return;
        }
        setCreatingRoom(false);
        setRoomName("");
        setSelectedMembers([]);
        setSelectedRoomId(data.room?.chat_room_id);
        setRoomData(data);
        setActiveTab("groups");
        await loadBootstrap({silent: true});
    };

    const leaveRoom = async (roomId) => {
        const data = await safeApiPost(`/chat/rooms/${roomId}/leave`, {});
        if (data?.message) {
            showToast(getErrorMessage(data, "Could not exit chat"));
            return;
        }
        socket.emit("chat:leave_room", {room_id: roomId});
        setConfirmLeaveRoomId(null);
        setCreatingRoom(false);
        setInvitePanelOpen(false);
        setInviteUserId("");
        setSelectedRoomId(null);
        setRoomData(null);
        await loadBootstrap({silent: true});
        showToast("Exited group chat");
    };

    const sendInvite = async (roomId) => {
        if (!inviteUserId) {
            showToast("Choose a classmate to invite");
            return;
        }
        const data = await safeApiPost(`/chat/rooms/${roomId}/invites`, {user_id: inviteUserId});
        if (data?.message) {
            showToast(getErrorMessage(data, "Could not send invite"));
            return;
        }
        setInvitePanelOpen(false);
        setInviteUserId("");
        await loadBootstrap({silent: true});
        showToast("Invite sent");
    };

    const respondInvite = async (inviteId, action) => {
        const data = await safeApiPost(`/chat/invites/${inviteId}/respond`, {action});
        if (data?.message) {
            showToast(getErrorMessage(data, "Could not update invite"));
            return;
        }
        if (action === "accept" && data.room_id) {
            setSelectedRoomId(data.room_id);
            setActiveTab("groups");
            socket.emit("chat:join_room", {room_id: data.room_id});
        }
        await loadBootstrap({silent: true});
        showToast(action === "accept" ? "Invite accepted" : "Invite declined");
    };

    const toggleMember = (userId) => {
        setSelectedMembers((current) =>
            current.includes(userId)
                ? current.filter((id) => id !== userId)
                : [...current, userId]
        );
    };

    const react = async (messageId, emoji) => {
        const data = await safeApiPost(`/chat/messages/${messageId}/reactions`, {emoji});
        if (data?.message) {
            showToast(data.message);
            return;
        }
        setReactionPickerId(null);
        await refreshActive();
    };

    const renderError = () => (
        <div className="chat-error" role="status">
            <p>{error}</p>
            <button type="button" onClick={() => loadBootstrap()}>
                Retry
            </button>
        </div>
    );

    const renderMessages = (messages, {readOnly = false, allowReactions = false, showDate = false} = {}) => (
        <div className="chat-message-list">
            {messages.length > 0 ? messages.map((message) => (
                <article
                    className={`chat-message${String(message.sender_user_id) === String(currentUser?.user_id) ? " chat-message--mine" : ""}`}
                    key={message.chat_message_id}
                >
                    <div className="chat-message__meta">
                        <strong>{message.sender_name}</strong>
                        <span>{formatTime(message.created_at, {withDate: showDate})}</span>
                    </div>
                    <p>{message.message_text}</p>
                    {allowReactions && (
                        <div className="chat-reactions" aria-label="Message reactions">
                            <div className="chat-reaction-summary">
                                {(message.reactions || []).filter((reaction) => reaction.count > 0).map((reaction) => (
                                    <button
                                        className={reaction.reacted_by_me ? "is-active" : ""}
                                        key={reaction.emoji}
                                        type="button"
                                        onClick={() => react(message.chat_message_id, reaction.emoji)}
                                        title={`React ${reaction.emoji}`}
                                        aria-label={`React ${reaction.emoji}`}
                                    >
                                        <span>{reaction.emoji}</span>
                                        <b>{reaction.count}</b>
                                    </button>
                                ))}
                            </div>
                            <div className="chat-reaction-picker-wrap">
                                <button
                                    className="chat-react-trigger"
                                    type="button"
                                    onClick={() => setReactionPickerId((current) =>
                                        current === message.chat_message_id ? null : message.chat_message_id
                                    )}
                                    aria-expanded={reactionPickerId === message.chat_message_id}
                                >
                                    React
                                </button>
                                {reactionPickerId === message.chat_message_id && (
                                    <div className="chat-reaction-picker" role="menu">
                                        {allowedEmojis.map((emoji) => (
                                            <button
                                                key={emoji}
                                                type="button"
                                                onClick={() => react(message.chat_message_id, emoji)}
                                                aria-label={`React ${emoji}`}
                                            >
                                                {emoji}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </article>
            )) : (
                <p className="chat-empty">{readOnly ? "No messages to inspect yet." : "No messages yet."}</p>
            )}
        </div>
    );

    const renderAnnouncements = () => (
        <section className="chat-panel-body">
            {isInstructor && (
                <div className="chat-composer chat-composer--broadcast">
                    <textarea
                        maxLength={maxLength}
                        onChange={(event) => updateText(event.target.value, setBroadcastText)}
                        placeholder="Broadcast to all students"
                        value={broadcastText}
                    />
                    <div className="chat-emoji-row" aria-label="Broadcast emoji picker">
                        {allowedEmojis.map((emoji) => (
                            <button
                                key={emoji}
                                type="button"
                                onClick={() => appendEmoji(broadcastText, setBroadcastText, emoji)}
                                aria-label={`Add ${emoji}`}
                            >
                                {emoji}
                            </button>
                        ))}
                    </div>
                    <div className="chat-composer__footer">
                        <span>{broadcastText.length}/{maxLength}</span>
                        <button type="button" onClick={sendBroadcast} disabled={!broadcastText.trim()}>
                            Send
                        </button>
                    </div>
                </div>
            )}
            {renderMessages(bootstrap.broadcast?.messages || [], {readOnly: true, allowReactions: true, showDate: true})}
        </section>
    );

    const renderRoomCreate = () => (
        <div className="chat-create">
            <label>
                <span>Chat name</span>
                <input
                    maxLength={60}
                    onChange={(event) => setRoomName(event.target.value)}
                    placeholder="Optional"
                    value={roomName}
                />
            </label>
            <div className="chat-create__students">
                {(bootstrap.available_students || []).length > 0 ? bootstrap.available_students.map((student) => (
                    <label key={student.user_id}>
                        <input
                            checked={selectedMembers.includes(student.user_id)}
                            onChange={() => toggleMember(student.user_id)}
                            type="checkbox"
                        />
                        <span>{student.name}</span>
                    </label>
                )) : (
                    <p className="chat-empty">No classmates available in your group.</p>
                )}
            </div>
            <div className="chat-create__actions">
                <button type="button" onClick={() => setCreatingRoom(false)}>Cancel</button>
                <button type="button" onClick={createRoom}>Create</button>
            </div>
        </div>
    );

    const renderPendingInvites = () => {
        if (isInstructor || pendingInvites.length === 0) return null;
        return (
            <div className="chat-invites">
                {pendingInvites.map((invite) => (
                    <article key={invite.chat_room_invite_id}>
                        <div>
                            <strong>{invite.room_name}</strong>
                            <span>Invited by {invite.invited_by_name}</span>
                        </div>
                        <button type="button" onClick={() => respondInvite(invite.chat_room_invite_id, "accept")}>
                            Join
                        </button>
                        <button type="button" onClick={() => respondInvite(invite.chat_room_invite_id, "decline")}>
                            Decline
                        </button>
                    </article>
                ))}
            </div>
        );
    };

    const renderGroups = () => (
        <section className="chat-panel-body chat-panel-body--split">
            <div className="chat-room-list">
                {renderPendingInvites()}
                {!isInstructor && !hasGroupRoom && (
                    <button className="chat-new-room" type="button" onClick={() => setCreatingRoom(true)}>
                        New group chat
                    </button>
                )}
                {creatingRoom && renderRoomCreate()}
                {bootstrap.rooms.length > 0 ? bootstrap.rooms.map((room) => (
                    <button
                        className={String(room.chat_room_id) === String(selectedRoomId) ? "is-active" : ""}
                        key={room.chat_room_id}
                        onClick={() => {
                            setSelectedRoomId(room.chat_room_id);
                            setCreatingRoom(false);
                            setConfirmLeaveRoomId(null);
                        }}
                        type="button"
                    >
                        <strong>{room.room_name}</strong>
                        <span>{room.course_group_name || `${room.member_count} members`}</span>
                        {room.unread_count > 0 && <b>{room.unread_count}</b>}
                    </button>
                )) : (
                    <p className="chat-empty">{isInstructor ? "No student group chats yet." : "Create a group chat to begin."}</p>
                )}
            </div>

            <div className="chat-room-thread">
                {selectedRoom ? (
                    <>
                        <div className="chat-room-thread__header">
                            <div>
                                <strong>{selectedRoom.room_name}</strong>
                                <span>
                                    {isInstructor
                                        ? `${selectedRoom.course_group_name || "Group"} inspection`
                                        : `${roomData?.members?.length || selectedRoom.member_count || 0} members`}
                                </span>
                            </div>
                            {!isInstructor && (
                                <div className="chat-room-actions">
                                    {bootstrap.available_students.length > 0 && (
                                        <button
                                            className="chat-invite-room"
                                            type="button"
                                            onClick={() => setInvitePanelOpen((current) => !current)}
                                            aria-label="Invite classmate"
                                            title="Invite classmate"
                                        >
                                            +
                                        </button>
                                    )}
                                    <button
                                        className="chat-exit-room"
                                        type="button"
                                        onClick={() => setConfirmLeaveRoomId(selectedRoom.chat_room_id)}
                                        aria-label="Exit group chat"
                                        title="Exit group chat"
                                    >
                                        ×
                                    </button>
                                </div>
                            )}
                        </div>
                        {invitePanelOpen && selectedRoom && (
                            <div className="chat-invite-panel">
                                <select
                                    value={inviteUserId}
                                    onChange={(event) => setInviteUserId(event.target.value)}
                                    aria-label="Choose classmate to invite"
                                >
                                    <option value="">Choose classmate</option>
                                    {bootstrap.available_students.map((student) => (
                                        <option key={student.user_id} value={student.user_id}>
                                            {student.name}
                                        </option>
                                    ))}
                                </select>
                                <button type="button" onClick={() => sendInvite(selectedRoom.chat_room_id)}>
                                    Invite
                                </button>
                            </div>
                        )}
                        {confirmLeaveRoomId === selectedRoom.chat_room_id && (
                            <div className="chat-confirm-exit" role="alert">
                                <span>Exit this group chat?</span>
                                <button type="button" onClick={() => leaveRoom(selectedRoom.chat_room_id)}>Yes</button>
                                <button type="button" onClick={() => setConfirmLeaveRoomId(null)}>No</button>
                            </div>
                        )}
                        {renderMessages(roomData?.messages || [], {readOnly: isInstructor, allowReactions: false})}
                        {!isInstructor && (
                            <div className="chat-composer">
                                <textarea
                                    maxLength={maxLength}
                                    onChange={(event) => updateText(event.target.value, setMessageText)}
                                    placeholder="Message this chat"
                                    value={messageText}
                                />
                                <div className="chat-emoji-row" aria-label="Message emoji picker">
                                    {allowedEmojis.map((emoji) => (
                                        <button
                                            key={emoji}
                                            type="button"
                                            onClick={() => appendEmoji(messageText, setMessageText, emoji)}
                                            aria-label={`Add ${emoji}`}
                                        >
                                            {emoji}
                                        </button>
                                    ))}
                                </div>
                                <div className="chat-composer__footer">
                                    <span>{messageText.length}/{maxLength}</span>
                                    <button type="button" onClick={sendMessage} disabled={!messageText.trim()}>
                                        Send
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                ) : (
                    <p className="chat-empty">Select a chat.</p>
                )}
            </div>
        </section>
    );

    if (!currentUser?.user_id) return null;

    return (
        <>
            <button
                className="chat-launcher"
                type="button"
                onClick={() => setOpen(true)}
                aria-label={`Open chat${unreadTotal ? `, ${unreadTotal} unread` : ""}`}
            >
                <span>Chat</span>
                {unreadTotal > 0 && <b>{unreadTotal > 99 ? "99+" : unreadTotal}</b>}
            </button>

            {open && (
                <div className="chat-drawer" role="dialog" aria-modal="true" aria-label="Course chat">
                    <button className="chat-drawer__backdrop" type="button" onClick={() => setOpen(false)} aria-label="Close chat" />
                    <section className="chat-drawer__panel">
                        <header className="chat-drawer__header">
                            <div>
                                <strong>Course Chat</strong>
                                <span>{currentUser.course_group_name || currentUser.course_name}</span>
                            </div>
                            <button type="button" onClick={() => setOpen(false)} aria-label="Close chat">×</button>
                        </header>

                        <nav className="chat-tabs" aria-label="Chat sections">
                            {tabs.map((tab) => (
                                <button
                                    className={activeTab === tab.id ? "is-active" : ""}
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    type="button"
                                >
                                    {tab.label}
                                </button>
                            ))}
                        </nav>

                        {loading ? <p className="chat-empty">Loading chat...</p> : (
                            error ? renderError() : (
                                activeTab === "announcements" ? renderAnnouncements() : renderGroups()
                            )
                        )}
                    </section>
                </div>
            )}

            {toast && <div className="chat-toast" role="status">{toast}</div>}
        </>
    );
}
