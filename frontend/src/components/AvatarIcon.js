import React from "react";
import {
    avatarIconFramePosition,
    avatarFallbackSrc,
    avatarSpriteSheetSrc,
} from "../utils/avatarAssets";
import "./AvatarIcon.css";

const AvatarIcon = ({path, alt = "Avatar", className = ""}) => {
    if (!path) {
        return <img src={avatarFallbackSrc()} alt={alt} className={className} />;
    }

    return (
        <span
            aria-label={alt}
            className={`avatar-icon ${className}`.trim()}
            role="img"
        >
            <span
                className="avatar-icon__frame"
                style={{
                    backgroundImage: `url(${avatarSpriteSheetSrc(path)})`,
                    backgroundPosition: avatarIconFramePosition(),
                }}
            />
        </span>
    );
};

export default AvatarIcon;
