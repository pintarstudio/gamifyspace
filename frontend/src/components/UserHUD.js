import React from "react";
import "./UserHUD.css";

const avatarSrc = (path) => {
  if (!path) return "/avatars/default.png";
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `/avatars${normalized}/thumbnail.png`;
};

const UserHUD = ({ currentUser, handleLogout, summary }) => {
  if (!currentUser) return null;

  const gamificationEnabled = !!currentUser.gamification_enabled;
  const groupXp = summary?.total_group_xp || 0;

  return (
    <section className={`user-hud${gamificationEnabled ? " user-hud--game" : ""}`}>
      <img src={avatarSrc(currentUser.avatar_public_path)} alt={currentUser.name} className="user-hud__avatar" />

      <div className="user-hud__body">
        <div className="user-hud__name">{currentUser.name}</div>
        {gamificationEnabled && (
          <div className="user-hud__xp">
            <span>Group XP</span>
            <strong>{groupXp}</strong>
          </div>
        )}
      </div>

      <button onClick={handleLogout} className="user-hud__logout">
        Logout
      </button>
    </section>
  );
};

export default UserHUD;
