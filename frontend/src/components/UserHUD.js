import React from "react";
import AvatarIcon from "./AvatarIcon";
import "./UserHUD.css";

const UserHUD = ({ currentUser, handleLogout, summary, hideAvatar = false }) => {
  if (!currentUser) return null;

  const gamificationEnabled = !!currentUser.gamification_enabled;
  const roleName = currentUser.role_name || "Student";
  const isStudent = String(roleName).toLowerCase() === "student" || String(currentUser.role_id || "") === "1";
  const virtualSpaceEnabled = currentUser.virtual_space_enabled !== undefined
    ? !!currentUser.virtual_space_enabled
    : !currentUser.use_no_virtual_space;
  const surveyLink = gamificationEnabled && isStudent
    ? (virtualSpaceEnabled
      ? "https://forms.gle/TrJo8XzcZGy82eub8"
      : "https://forms.gle/JCEfscoijjJ8D6an8")
    : "";
  const groupXp = summary?.total_group_xp || 0;
  const individualXp = summary?.total_individual_exercise_xp || 0;
  const courseName = currentUser.course_name || "Course";
  const groupName = currentUser.course_group_name || "No group";
  const individualLevel = summary?.individual_level || {
    level: 1,
    name: "Rookie",
    color: "#6B7280",
    progress_to_next_level: 0,
  };

  return (
    <section className={`user-hud${gamificationEnabled ? " user-hud--game" : ""}${hideAvatar ? " user-hud--plain" : ""}`}>
      {!hideAvatar && (
        <AvatarIcon path={currentUser.avatar_public_path} alt={currentUser.name} className="user-hud__avatar" />
      )}

      <div className="user-hud__body">
        <div className="user-hud__name">{currentUser.name}</div>
        <div className="user-hud__role">{roleName}</div>
        <div className="user-hud__meta" aria-label={`${courseName}, ${groupName}`}>
          <span>{courseName}</span>
          <span>{groupName}</span>
        </div>
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

      <div className="user-hud__actions">
        <button onClick={handleLogout} className="user-hud__logout">
          Logout
        </button>
        {surveyLink && (
          <a
            className="user-hud__survey"
            href={surveyLink}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open feedback form"
            title="Open feedback form"
          >
            ↗
          </a>
        )}
      </div>
    </section>
  );
};

export default UserHUD;
