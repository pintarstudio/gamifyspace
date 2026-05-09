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
  const individualXp = summary?.total_individual_exercise_xp || 0;
  const individualLevel = summary?.individual_level || {
    level: 1,
    name: "Rookie",
    color: "#6B7280",
    progress_to_next_level: 0,
  };

  return (
    <section className={`user-hud${gamificationEnabled ? " user-hud--game" : ""}`}>
      <img src={avatarSrc(currentUser.avatar_public_path)} alt={currentUser.name} className="user-hud__avatar" />

      <div className="user-hud__body">
        <div className="user-hud__name">{currentUser.name}</div>
        {gamificationEnabled && (
          <>
            <div className="user-hud__xp-list">
              <div className="user-hud__xp">
                <span>Group XP</span>
                <strong>{groupXp}</strong>
              </div>
            </div>
            <div
              className="user-hud__level"
              style={{"--level-color": individualLevel.color || "#6B7280"}}
            >
              <div className="user-hud__level-title">
                <span>Level {individualLevel.level}</span>
                <strong>{individualLevel.name}</strong>
              </div>
              <div className="user-hud__level-xp">
                <span>Individual XP</span>
                <strong>{individualXp}</strong>
              </div>
              <div className="user-hud__level-bar" aria-label={`Level progress ${individualLevel.progress_to_next_level || 0}%`}>
                <div style={{width: `${Math.max(0, Math.min(100, individualLevel.progress_to_next_level || 0))}%`}} />
              </div>
              <small>
                {individualLevel.next_level_xp
                  ? `${Math.max(0, individualLevel.next_level_xp - individualXp)} XP to next level`
                  : "Max level reached"}
              </small>
            </div>
          </>
        )}
      </div>

      <button onClick={handleLogout} className="user-hud__logout">
        Logout
      </button>
    </section>
  );
};

export default UserHUD;
