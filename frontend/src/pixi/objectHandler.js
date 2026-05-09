import * as PIXI from "pixi.js";
import socket from "../utils/socketClient";

console.log("🟦 [objectHandler] Initializing interactable objects...");

const getObjectProperty = (obj, name) =>
    obj.properties?.find((p) => p.name === name)?.value;

const hasValue = (value) => value !== undefined && value !== null && value !== "";

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

            // Hint text
            const hintText = new PIXI.Text({
                text: "Press S to start activity",
                style: {
                    fontSize: 14,
                    fill: "#ffffff",
                    fontWeight: "bold",
                    backgroundColor: "#000000",
                },
                textureStyle: {
                    scaleMode: 'linear',
                }
            });
            hintText.visible = false;
            hintText.anchor.set(0.5);
            hintText.x = sprite.x + sprite.width / 2;
            hintText.y = sprite.y - 18;

            // Keep hint above the object for visibility
            hintText.zIndex = sprite.zIndex + 1;

            worldContainer.addChild(hintText);

            objects.push({sprite, hintText, actionProp, urlProp, idProp, nameProp, groupProp, obj, targetRoomProp});
        });
    });

    // Global keydown handler
    const keydownHandler = (e) => {
        console.log("🟧 [objectHandler] Keydown detected:", e.key);
        if (e.key.toLowerCase() !== "s" || e.repeat) return;

        const activeObject = objects.find((o) => o.hintText.visible);
        if (!activeObject) return;

        e.preventDefault();

        const userId = user.user_id || user.id || null;
        const objectName = activeObject.nameProp || activeObject.obj.name || "unknown_object";
        const objectId = hasValue(activeObject.idProp) ? activeObject.idProp : activeObject.obj.id || null;
        const objectKind = String(objectName).toLowerCase();
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
            if (!o?.sprite) continue;

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
