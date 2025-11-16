import * as PIXI from "pixi.js";

/**
 * Initialize map and collision from Tiled JSON
 * @param {PIXI.Application} app
 * @param {Object} roomData
 * @returns {Promise<{worldContainer: PIXI.Container, checkCollision: Function, TILE_SIZE: number, mapWidth: number, mapHeight: number}>}
 */
export async function initMap(app, roomData) {
    const TILE_SIZE = roomData.tilewidth;
    const mapWidth = roomData.width * TILE_SIZE;
    const mapHeight = roomData.height * TILE_SIZE;

    // Load tileset texture
    const tileset = roomData.tilesets[0];
    const texture = await PIXI.Assets.load(`/tiles/${tileset.image}`);
    const source = texture.source;

    const firstGid = tileset.firstgid || 1;
    const tilesPerRow = Math.floor(tileset.imagewidth / tileset.tilewidth);
    const margin = tileset.margin || 0;
    const spacing = tileset.spacing || 0;

    // Create main world container
    const worldContainer = new PIXI.Container();

    // Build tile layers
    roomData.layers
        .filter((layer) => layer.type === "tilelayer")
        .forEach((layer) => {
            const offsetX = layer.offsetx || 0;
            const offsetY = layer.offsety || 0;

            layer.data.forEach((gid, i) => {
                if (gid === 0) return;
                const localIndex = gid - firstGid;
                if (localIndex < 0) return;

                const col = i % roomData.width;
                const row = Math.floor(i / roomData.width);

                const srcX = margin + (localIndex % tilesPerRow) * (TILE_SIZE + spacing);
                const srcY = margin + Math.floor(localIndex / tilesPerRow) * (TILE_SIZE + spacing);

                const tileTexture = new PIXI.Texture({
                    source,
                    frame: new PIXI.Rectangle(srcX, srcY, TILE_SIZE, TILE_SIZE),
                });

                const sprite = new PIXI.Sprite({
                    texture: tileTexture,
                    textureStyle: {
                        scaleMode: 'nearest',
                    }
                });
                sprite.x = col * TILE_SIZE + offsetX;
                sprite.y = row * TILE_SIZE + offsetY;
                worldContainer.addChild(sprite);
            });
        });

    // --- Collision Layer ---
    const collisionLayer = roomData.layers.find(
        (layer) =>
            layer.name === "collision" ||
            layer.properties?.some((p) => p.name === "collision" && p.value === true)
    );

    const collisionMap = new Set();
    if (collisionLayer) {
        collisionLayer.data.forEach((gid, index) => {
            if (gid !== 0) collisionMap.add(index);
        });
    }

    // Function to check collision at given pixel coordinate
    const checkCollision = (x, y) => {
        const col = Math.floor(x / TILE_SIZE);
        const row = Math.floor(y / TILE_SIZE);
        const index = row * roomData.width + col;
        return collisionMap.has(index);
    };

    return {worldContainer, checkCollision, TILE_SIZE, mapWidth, mapHeight};
}