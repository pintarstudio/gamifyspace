import React from "react";

const UserHUD = ({ currentUser, handleLogout }) => {
  if (!currentUser) return null;

  return (
    <div style={styles.container}>
      <img
        src={`/avatars/${currentUser.avatar_public_path}/thumbnail.png`}
        alt="avatar"
        style={styles.avatar}
      />
      <div style={{ textAlign: "left" }}>
        <strong>{currentUser.name}</strong>
        <div style={{ fontSize: "0.9em" }}>Level: 3 | XP: 120 / 200</div>
      </div>
      <button onClick={handleLogout} style={styles.logout}>
        Logout
      </button>
    </div>
  );
};

const styles = {
  container: {
    position: "absolute",
    top: 15,
    left: 15,
    background: "rgba(0, 0, 0, 0.6)",
    color: "#fff",
    padding: "10px 15px",
    borderRadius: "10px",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    zIndex: 1000,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: "50%",
    objectFit: "cover",
    border: "2px solid #fff",
  },
  logout: {
    background: "#d9534f",
    color: "#fff",
    border: "none",
    padding: "6px 12px",
    borderRadius: "6px",
    cursor: "pointer",
    marginLeft: "auto",
  },
};

export default UserHUD;