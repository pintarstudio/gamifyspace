import * as PIXI from "pixi.js";
import socket from "../utils/socketClient";

console.log("🟦 [objectHandler] Initializing interactable objects...");

const getObjectProperty = (obj, name) =>
    obj.properties?.find((p) => p.name === name)?.value;

const hasValue = (value) => value !== undefined && value !== null && value !== "";

const GUIDE_MESSAGES = {
    "guide-discussion": "Bentuk tim maksimal 4 orang, pecahkan studi kasus, dan raih poin bersama!",
    "guide-computer": "Latihan mandiri, pre-test, dan post-test dimulai dari sini.",
    "guide-competition": "Siap berduel? Tantang temanmu 1 vs 1!",
};

const getGuideMessage = (name) => GUIDE_MESSAGES[String(name || "").toLowerCase()] || null;

const getGuideBubbleColors = (name) => {
    const normalized = String(name || "").toLowerCase();
    if (normalized === "guide-computer") return {fill: 0x30260f, border: 0xfacc15};
    if (normalized === "guide-competition") return {fill: 0x321525, border: 0xfb7185};
    return {fill: 0x102a43, border: 0x6ee7f9};
};

const createPixelBubble = ({
    text,
    fontSize = 12,
    maxWidth = 180,
    fill = 0x172033,
    border = 0xffd45c,
    textFill = "#ffffff",
} = {}) => {
    const paddingX = 10;
    const paddingY = 7;
    const borderSize = 3;
    const shadowOffset = 4;
    const container = new PIXI.Container();

    const label = new PIXI.Text({
        text,
        style: {
            fontFamily: "monospace",
            fontSize,
            fill: textFill,
            fontWeight: "900",
            align: "center",
            wordWrap: true,
            wordWrapWidth: maxWidth,
            lineHeight: Math.ceil(fontSize * 1.45),
            stroke: {
                color: "#111827",
                width: 2,
            },
        },
        textureStyle: {
            scaleMode: "nearest",
        },
    });

    label.anchor.set(0.5);
    const bubbleWidth = Math.ceil(label.width + paddingX * 2);
    const bubbleHeight = Math.ceil(label.height + paddingY * 2);
    const corner = 5;

    const shadow = new PIXI.Graphics()
        .rect(corner + shadowOffset, shadowOffset, bubbleWidth - corner * 2, bubbleHeight)
        .rect(shadowOffset, corner + shadowOffset, bubbleWidth, bubbleHeight - corner * 2)
        .fill(0x111827);
    shadow.alpha = 0.55;

    const background = new PIXI.Graphics()
        .rect(corner, 0, bubbleWidth - corner * 2, bubbleHeight)
        .rect(0, corner, bubbleWidth, bubbleHeight - corner * 2)
        .fill(border)
        .rect(corner + borderSize, borderSize, bubbleWidth - (corner + borderSize) * 2, bubbleHeight - borderSize * 2)
        .rect(borderSize, corner + borderSize, bubbleWidth - borderSize * 2, bubbleHeight - (corner + borderSize) * 2)
        .fill(fill);

    const shine = new PIXI.Graphics()
        .rect(corner + borderSize, borderSize, bubbleWidth - (corner + borderSize) * 2, 2)
        .fill(0xffffff);
    shine.alpha = 0.22;

    label.x = bubbleWidth / 2;
    label.y = bubbleHeight / 2;

    container.addChild(shadow, background, shine, label);
    container.pivot.set(bubbleWidth / 2, bubbleHeight);
    container.__bubbleWidth = bubbleWidth;
    container.__bubbleHeight = bubbleHeight;
    return container;
};

const buildInteractionUrl = (baseUrl, params) => {
    if (!baseUrl) return null;

    try {
        const url = new URL(baseUrl, window.location.origin);
        Object.entries(params).forEach(([key, value]) => {
            if (hasValue(value)) url.searchParams.set(key, String(value));
        });
        return url.toString();
    } catch (err) {
        console.error("🟥 [objectHandler] Invalid object URL:", baseUrl, err);
        return null;
    }
};

/**
 * Initialize interactable objects from roomData (object layer)
 * @param {PIXI.Application} app
 * @param {PIXI.Container} worldContainer
 * @param {Object} roomData
 * @param {Object} user
 * @param {Object} localUserRef
 * @param {number} zoomFactor
 * @param {Function} handleRoomChange
 */
export function initObjects(app, worldContainer, roomData, user, localUserRef, zoomFactor, handleRoomChange) {
    const objectLayer = roomData.layers.find(
        (l) => l.type === "objectgroup" && l.name === "interactables"
    );
    if (!objectLayer || !objectLayer.objects) return;
    console.log("🟨 [objectHandler] Object layer found:", objectLayer?.name, "Total objects:", objectLayer?.objects?.length || 0);

    const objects = [];

    // Proximity highlight tuning
    const proximityRadius = 40;
    const HIGHLIGHT_TINT = 0xffffcc;
    const PULSE_AMPL = 0.06;       // 6% scale pulse
    const PULSE_SPEED = 0.008;     // lower = slower pulse

    objectLayer.objects.forEach((obj) => {
        const idProp = getObjectProperty(obj, "id");
        const nameProp = getObjectProperty(obj, "name");
        const imageProp = getObjectProperty(obj, "image");
        const actionProp = getObjectProperty(obj, "action");
        const urlProp = getObjectProperty(obj, "url");
        const groupProp = getObjectProperty(obj, "group");
        const targetRoomProp = getObjectProperty(obj, "targetRoom");
        console.log(nameProp);
        console.log("🟪 [objectHandler] Loading object:", {idProp, nameProp, imageProp, actionProp, urlProp, groupProp, targetRoomProp});
        if (!imageProp) return;

        PIXI.Assets.load(`/${imageProp}`).then((texture) => {
            // Build sprite
            const source = texture.source;
            const tileX = getObjectProperty(obj, "tileX") || 0;
            const tileY = getObjectProperty(obj, "tileY") || 0;
            const tileFrame = new PIXI.Rectangle(tileX, tileY, obj.width, obj.height);
            const tileTexture = new PIXI.Texture({source, frame: tileFrame});
            const sprite = new PIXI.Sprite({
                texture: tileTexture,
                textureStyle: {
                    scaleMode: 'nearest',
                },
            });

            sprite.x = obj.x;
            sprite.y = obj.y - obj.height;
            sprite.scale.set(zoomFactor);

            // Save base scale so we can pulse/restore cleanly
            const baseScaleX = sprite.scale.x;
            const baseScaleY = sprite.scale.y;
            sprite.__baseScaleX = baseScaleX;
            sprite.__baseScaleY = baseScaleY;

            // Save original tint/alpha
            sprite.__baseTint = sprite.tint ?? 0xffffff;
            sprite.__baseAlpha = sprite.alpha ?? 1;

            // Top-down depth sorting: use the bottom edge of the object
            // (sprite.y is the top; sprite.y + sprite.height is the bottom)
            sprite.zIndex = sprite.y + sprite.height;

            sprite.interactive = true;
            sprite.buttonMode = true;
            worldContainer.addChild(sprite);
            // Ensure correct render order after adding new objects
            if (worldContainer.sortableChildren) worldContainer.sortChildren();

            const guideMessage = getGuideMessage(nameProp);
            const guideColors = getGuideBubbleColors(nameProp);
            const hasInteraction = !!guideMessage || !!urlProp || !!actionProp || !!targetRoomProp;

            const hintText = hasInteraction ? createPixelBubble({
                text: guideMessage ? "Press s to ask" : "Press S to start activity",
                fontSize: guideMessage ? 11 : 12,
                maxWidth: guideMessage ? 120 : 190,
                fill: guideMessage ? guideColors.fill : 0x1f2937,
                border: guideMessage ? guideColors.border : 0xffd45c,
            }) : null;

            if (hintText) {
                hintText.visible = false;
                hintText.x = sprite.x + sprite.width / 2;
                hintText.y = sprite.y - 18;
                hintText.zIndex = sprite.zIndex + 1;

                worldContainer.addChild(hintText);
            }

            const infoText = guideMessage ? createPixelBubble({
                text: guideMessage,
                fontSize: 11,
                maxWidth: 260,
                fill: guideColors.fill,
                border: guideColors.border,
            }) : null;

            if (infoText) {
                infoText.visible = false;
                infoText.x = sprite.x + sprite.width / 2;
                infoText.y = sprite.y - 36;
                infoText.zIndex = sprite.zIndex + 2;
                worldContainer.addChild(infoText);
            }

            objects.push({sprite, hintText, infoText, actionProp, urlProp, idProp, nameProp, groupProp, obj, targetRoomProp, hasInteraction});
        });
    });

    // Global keydown handler
    const keydownHandler = (e) => {
        console.log("🟧 [objectHandler] Keydown detected:", e.key);
        if (e.key.toLowerCase() !== "s" || e.repeat) return;

        const activeObject = objects.find((o) => o.hintText?.visible);
        if (!activeObject) return;

        e.preventDefault();

        const userId = user.user_id || user.id || null;
        const objectName = activeObject.nameProp || activeObject.obj.name || "unknown_object";
        const objectId = hasValue(activeObject.idProp) ? activeObject.idProp : activeObject.obj.id || null;
        const objectKind = String(objectName).toLowerCase();
        if (getGuideMessage(objectName)) {
            if (activeObject.infoText) {
                activeObject.infoText.visible = true;
                activeObject.infoText.x = activeObject.sprite.x + activeObject.sprite.width / 2;
                activeObject.infoText.y = activeObject.sprite.y - 36;
                activeObject.infoText.__hideAt = performance.now() + 7000;
            }

            socket.emit("interact_obj", {
                user_id: userId,
                object_name: objectName,
                object_id: objectId,
                action: "ask",
            });
            return;
        }

        const bigTablePairId = Number.isFinite(Number(objectId))
            ? `bigtable-${Math.ceil(Number(objectId) / 2)}`
            : objectId;
        const tableId = objectKind === "bigtable" ? (activeObject.groupProp || bigTablePairId) : null;
        const groupId = objectKind === "table" ? activeObject.groupProp : tableId;
        const finalUrl = buildInteractionUrl(activeObject.urlProp, {
            user_id: userId,
            object_name: objectName,
            object_id: objectId,
            group_id: groupId,
            table_id: tableId,
        });

        if (!finalUrl) return;

        console.log("🟥 [objectHandler] start activity triggered for:", activeObject.nameProp, "→", finalUrl);
        const popup = window.open(
            finalUrl,
            "popupWindow",
            "popup=yes,width=800,height=600,top=100,left=100,resizable=yes,scrollbars=yes,status=no"
        );
        if (popup) popup.focus();

        socket.emit("interact_obj", {
            user_id: userId,
            object_name: objectName,
            object_id: objectId,
            group_id: groupId,
            table_id: tableId,
            action: "openurl",
            url: finalUrl,
        });
    };
    window.addEventListener("keydown", keydownHandler);

    // Proximity detection loop (highlight ONLY the nearest object to avoid confusion)
    app.ticker.add(() => {
        const localUser = localUserRef.current;
        if (!localUser) return;

        // Find nearest object within radius
        let nearest = null;
        let nearestDist = Infinity;

        for (let i = 0; i < objects.length; i++) {
            const o = objects[i];
            if (!o?.sprite || !o.hasInteraction) continue;

            const objCenterX = o.sprite.x + o.sprite.width / 2;
            const objCenterY = o.sprite.y + o.sprite.height / 2;
            const dx = localUser.x - objCenterX;
            const dy = localUser.y - objCenterY;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < proximityRadius && distance < nearestDist) {
                nearestDist = distance;
                nearest = o;
            }
        }

        // Apply highlight / pulse
        const t = (app.ticker.lastTime || performance.now()) * PULSE_SPEED;
        const pulse = 1 + Math.sin(t) * PULSE_AMPL;

        for (let i = 0; i < objects.length; i++) {
            const o = objects[i];
            if (!o?.sprite) continue;

            const isActive = o === nearest;

            // Hint: show only for the nearest interactable
            if (o.hintText) {
                o.hintText.visible = !!isActive;
                if (isActive) {
                    o.hintText.x = o.sprite.x + o.sprite.width / 2;
                    o.hintText.y = o.sprite.y - 18;
                }
            }

            if (o.infoText) {
                if (o.infoText.__hideAt && performance.now() > o.infoText.__hideAt) {
                    o.infoText.visible = false;
                    o.infoText.__hideAt = null;
                }
                if (o.infoText.visible) {
                    o.infoText.x = o.sprite.x + o.sprite.width / 2;
                    o.infoText.y = o.sprite.y - 36;
                }
            }

            if (isActive) {
                // Glow-ish highlight via tint + gentle scale pulse
                o.sprite.tint = HIGHLIGHT_TINT;
                o.sprite.alpha = 1;
                const bx = o.sprite.__baseScaleX ?? o.sprite.scale.x;
                const by = o.sprite.__baseScaleY ?? o.sprite.scale.y;
                o.sprite.scale.set(bx * pulse, by * pulse);

                // Keep sorting stable (object remains correctly in front/behind)
                o.sprite.zIndex = o.sprite.y + o.sprite.height;
                if (o.hintText) o.hintText.zIndex = o.sprite.zIndex + 1;
                if (o.infoText) o.infoText.zIndex = o.sprite.zIndex + 2;
            } else {
                // Restore normal look
                o.sprite.tint = o.sprite.__baseTint ?? 0xffffff;
                o.sprite.alpha = o.sprite.__baseAlpha ?? 1;
                const bx = o.sprite.__baseScaleX ?? o.sprite.scale.x;
                const by = o.sprite.__baseScaleY ?? o.sprite.scale.y;
                o.sprite.scale.set(bx, by);
            }
        }
    });

    // Cleanup global keydown handler when PIXI app is destroyed
    app.renderer.on("destroy", () => {
        window.removeEventListener("keydown", keydownHandler);
    });
}
