import {io} from "socket.io-client";

const socket = io("http://192.168.100.21:4000", {
    transports: ["websocket"],
    withCredentials: true,
});

export default socket;