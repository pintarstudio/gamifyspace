import React, {useEffect, useState, useRef} from "react";
import socket from "../utils/socketClient";
import "./VirtualSpace.css";

const VirtualSpace = ({user}) => {
    const [users, setUsers] = useState({});
    const [position, setPosition] = useState({x: 400, y: 300});
    const spaceRef = useRef(null);

    //Socket
    useEffect(() => {
        if (user) socket.emit("join", user);
        socket.on("update_users", (data) => {
            setUsers(data);
        });
        return () => {
            socket.off("update_users");
        };
    }, [user]);

    // Handle movement
    useEffect(() => {
        const handleKeyDown = (e) => {
            let { x, y } = position;
            const step = 10;
            if (e.key === "ArrowUp") y -= step;
            else if (e.key === "ArrowDown") y += step;
            else if (e.key === "ArrowLeft") x -= step;
            else if (e.key === "ArrowRight") x += step;
            else return;

            x = Math.max(40, Math.min(760, x));
            y = Math.max(40, Math.min(560, y));
            const newPos = { x, y };

            setPosition(newPos);
            socket.emit("move", newPos);
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [position]);

    return (
        <div ref={spaceRef} className="virtual-space">
            {Object.values(users).map((u, i) => (
                <div
                    key={i}
                    className="avatar"
                    style={{ left: u.x, top: u.y }}
                >
                    <img
                        src={u.avatar || "/default-avatar.png"}
                        alt={u.name}
                        className="avatar-img"
                    />
                    <div className="avatar-name">{u.name}</div>
                </div>
            ))}
        </div>
    );
};

export default VirtualSpace;