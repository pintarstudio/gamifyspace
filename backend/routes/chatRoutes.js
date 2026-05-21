import express from "express";
import {
    createRoom,
    getBootstrap,
    getRoomMessages,
    inviteToRoom,
    leaveRoom,
    reactToMessage,
    readRoom,
    respondInvite,
    sendBroadcast,
    sendRoomMessage,
} from "../controllers/chatController.js";

const router = express.Router();

router.get("/bootstrap", getBootstrap);
router.post("/broadcast", sendBroadcast);
router.post("/rooms", createRoom);
router.get("/rooms/:roomId/messages", getRoomMessages);
router.post("/rooms/:roomId/messages", sendRoomMessage);
router.post("/rooms/:roomId/read", readRoom);
router.post("/rooms/:roomId/leave", leaveRoom);
router.post("/rooms/:roomId/invites", inviteToRoom);
router.post("/invites/:inviteId/respond", respondInvite);
router.post("/messages/:messageId/reactions", reactToMessage);

export default router;
