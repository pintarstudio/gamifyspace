import * as PIXI from "pixi.js";
import socket from "../utils/socketClient";

console.log("🟦 [objectHandler] Initializing interactable objects...");
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
    objectLayer.objects.forEach((obj) => {
        const nameProp = obj.properties?.find((p) => p.name === "name")?.value;
        const imageProp = obj.properties?.find((p) => p.name === "image")?.value;
        const actionProp = obj.properties?.find((p) => p.name === "action")?.value;
        const urlProp = obj.properties?.find((p) => p.name === "url")?.value;
        const targetRoomProp = obj.properties?.find((p) => p.name === "targetRoom")?.value;
        console.log(nameProp);
        console.log("🟪 [objectHandler] Loading object:", { nameProp, imageProp, actionProp, urlProp, targetRoomProp });
        if (!imageProp) return;

        PIXI.Assets.load(`/${imageProp}`).then((texture) => {
            // Build sprite
            const source = texture.source;
            const tileX = obj.properties?.find(p => p.name === "tileX")?.value || 0;
            const tileY = obj.properties?.find(p => p.name === "tileY")?.value || 0;
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
            sprite.zIndex = 500;
            sprite.interactive = true;
            sprite.buttonMode = true;
            worldContainer.addChild(sprite);

            // Hint text
            const hintText = new PIXI.Text({
                text: "Press O to interact",
                style: {
                    fontSize: 12,
                    fill: "#ffffff",
                    fontWeight: "bold",
                    backgroundColor: "#000000",
                },
                textureStyle: {
                    scaleMode: 'nearest',
                }
            });
            hintText.visible = false;
            hintText.x = sprite.x;
            hintText.y = sprite.y - 20;
            worldContainer.addChild(hintText);

            objects.push({sprite, hintText, actionProp, urlProp, nameProp, obj, targetRoomProp});
        });
    });

    // Global keydown handler
    const keydownHandler = (e) => {
        console.log("🟧 [objectHandler] Keydown detected:", e.key);
        if (e.key.toLowerCase() !== "o") return;
        objects.forEach((o) => {
            if (!o.hintText.visible) return;

            if (o.actionProp === "openurl" && o.urlProp) {
                const queryParams = new URLSearchParams({
                    user_id: user.user_id || user.id,
                    name: user.name || "Guest",
                    email: user.email || "",
                }).toString();

                const finalUrl = o.urlProp.includes("?")
                    ? `${o.urlProp}&${queryParams}`
                    : `${o.urlProp}?${queryParams}`;
                console.log("🟥 [objectHandler] openurl action triggered for:", o.nameProp, "→", finalUrl);
                const popup = window.open(
                    finalUrl,
                    "popupWindow",
                    "popup=yes,width=800,height=600,top=100,left=100,resizable=yes,scrollbars=yes,status=no"
                );
                if (popup) popup.focus();

                socket.emit("interact_obj", {
                    user_id: user.user_id || user.id || null,
                    object_name: o.nameProp || o.obj.name || "unknown_object",
                    action: o.actionProp,
                    url: finalUrl,
                });
            }

            if (o.actionProp === "changeroom" && o.targetRoomProp) {
                console.log("🟥 [objectHandler] changeroom action triggered for:", o.nameProp, "→ target room:", o.targetRoomProp);
                socket.emit("interact_obj", {
                    user_id: user.user_id || user.id || null,
                    object_name: o.nameProp || o.obj.name || "door",
                    action: o.actionProp,
                    targetRoom: o.targetRoomProp,
                    url: "",
                });
                console.log("🟩 [objectHandler] handleRoomChange is function? ", typeof handleRoomChange);
                if (typeof handleRoomChange === "function") {
                    handleRoomChange(o.targetRoomProp);
                }
            }
        });
    };
    window.addEventListener("keydown", keydownHandler);

    // Proximity detection loop
    const proximityRadius = 40;
    app.ticker.add(() => {
        const localUser = localUserRef.current;
        if (!localUser) return;
        objects.forEach((o) => {
            const objCenterX = o.sprite.x + o.sprite.width / 2;
            const objCenterY = o.sprite.y + o.sprite.height / 2;
            const dx = localUser.x - objCenterX;
            const dy = localUser.y - objCenterY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            o.hintText.visible = distance < proximityRadius;
            if (o.hintText.visible) {
                console.log("🟦 [objectHandler] Proximity detected for:", o.nameProp, "Distance:", distance.toFixed(2));
            }
        });
    });

    // Cleanup global keydown handler when PIXI app is destroyed
    app.renderer.on("destroy", () => {
        window.removeEventListener("keydown", keydownHandler);
    });
}