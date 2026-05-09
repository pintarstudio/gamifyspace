import * as PIXI from "pixi.js";

export async function initMap(app, roomData) {
    const TILE_SIZE = roomData.tilewidth;
    const mapWidth = roomData.width * TILE_SIZE;
    const mapHeight = roomData.height * TILE_SIZE;

    // --- Helpers ---
    // Tiled encodes flipping/rotation flags in the high bits of the gid.
    // We strip those so we can map gid -> tileset correctly.
    const normalizeGid = (gid) => gid & 0x1fffffff;

    const joinTilesPath = (relPath) => {
        if (!relPath) return "";
        const cleaned = String(relPath)
            .replace(/\\/g, "/")
            .replace(/^\.\//, "")
            .replace(/^(\.\.\/)+/, "");
        return cleaned.startsWith("/") ? cleaned : `/tiles/${cleaned}`;
    };

    const loadTilesetFromTSX = async (tsxFile, firstgid) => {
        const tsxPath = joinTilesPath(tsxFile);
        const res = await fetch(tsxPath);
        if (!res.ok) {
            throw new Error(`Failed to load TSX tileset: ${tsxPath} (HTTP ${res.status})`);
        }
        const xmlText = await res.text();
        const doc = new DOMParser().parseFromString(xmlText, "application/xml");

        const tilesetEl = doc.querySelector("tileset");
        const imageEl = doc.querySelector("tileset > image");
        if (!tilesetEl || !imageEl) {
            throw new Error(`Invalid TSX tileset (missing <tileset> or <image>): ${tsxPath}`);
        }

        const tilewidth = parseInt(tilesetEl.getAttribute("tilewidth") || `${roomData.tilewidth}`, 10);
        const tileheight = parseInt(tilesetEl.getAttribute("tileheight") || `${roomData.tileheight}`, 10);
        const spacing = parseInt(tilesetEl.getAttribute("spacing") || "0", 10);
        const margin = parseInt(tilesetEl.getAttribute("margin") || "0", 10);
        const columnsAttr = parseInt(tilesetEl.getAttribute("columns") || "0", 10);

        const imageSource = imageEl.getAttribute("source") || "";
        const imagewidth = parseInt(imageEl.getAttribute("width") || "0", 10);
        const imageheight = parseInt(imageEl.getAttribute("height") || "0", 10);

        const imagePath = joinTilesPath(imageSource);
        const tex = await PIXI.Assets.load(imagePath);
        const source = tex.source;

        const tilesPerRow = columnsAttr > 0
            ? columnsAttr
            : Math.max(1, Math.floor((imagewidth || tex.width) / tilewidth));

        const tilesPerCol = Math.max(1, Math.floor((imageheight || tex.height) / tileheight));
        const tilecount = tilesPerRow * tilesPerCol;

        return {
            firstgid,
            tilewidth,
            tileheight,
            spacing,
            margin,
            tilesPerRow,
            tilecount,
            source,
        };
    };

    const loadTilesetFromImageField = async (ts, firstgid) => {
        // Prefer JSON tileset's direct PNG reference ("image")
        // Many Tiled exports can include only { firstgid, image, source }. In that case we infer
        // columns/rows from the loaded texture size and roomData tile size.
        const tilewidth = ts.tilewidth ?? roomData.tilewidth;
        const tileheight = ts.tileheight ?? roomData.tileheight;
        const spacing = ts.spacing || 0;
        const margin = ts.margin || 0;

        const imagePath = joinTilesPath(ts.image);
        const tex = await PIXI.Assets.load(imagePath);
        const source = tex.source;

        // Infer columns/rows from the actual texture size.
        // Use JSON columns if present; otherwise compute from texture width.
        const tilesPerRow = ts.columns
            ? ts.columns
            : Math.max(1, Math.floor((tex.width - margin * 2 + spacing) / (tilewidth + spacing)));

        const tilesPerCol = Math.max(1, Math.floor((tex.height - margin * 2 + spacing) / (tileheight + spacing)));
        const tilecount = ts.tilecount ?? tilesPerRow * tilesPerCol;

        return {
            firstgid,
            tilewidth,
            tileheight,
            spacing,
            margin,
            tilesPerRow,
            tilecount,
            source,
        };
    };

    const rawTilesets = Array.isArray(roomData.tilesets) ? roomData.tilesets : [];

    // Resolve ALL tilesets (supports multiple images via multiple TSX sources)
    const resolvedTilesets = (await Promise.all(
        rawTilesets.map(async (ts) => {
            const firstgid = ts.firstgid || 1;

            // Prefer direct PNG reference from JSON ("image")
            if (ts.image) {
                return await loadTilesetFromImageField(ts, firstgid);
            }

            // Fallback: TSX reference ("source")
            if (ts.source) {
                return await loadTilesetFromTSX(ts.source, firstgid);
            }

            throw new Error(`Tileset is missing both 'image' and 'source' fields (firstgid=${firstgid}).`);
        })
    ))
        .filter(Boolean)
        .sort((a, b) => a.firstgid - b.firstgid);

    const findTilesetForGid = (gid) => {
        // Choose the tileset with the greatest firstgid that is <= gid
        for (let i = resolvedTilesets.length - 1; i >= 0; i--) {
            if (gid >= resolvedTilesets[i].firstgid) return resolvedTilesets[i];
        }
        return null;
    };

    // Create main world container
    const worldContainer = new PIXI.Container();
    // Enable zIndex-based sorting (required for proper top-down occlusion)
    worldContainer.sortableChildren = true;

    // Cache textures per normalized gid (gid is globally unique across tilesets)
    const textureCache = new Map();

    // Build tile layers
    roomData.layers
        .filter((layer) => layer.type === "tilelayer")
        .forEach((layer) => {
            const offsetX = layer.offsetx || 0;
            const offsetY = layer.offsety || 0;

            const layerName = String(layer.name || "").toLowerCase();
            // Push floor far behind everything so walls/characters can occlude correctly
            const zBias = layerName.includes("floor") ? -100000 : 0;

            layer.data.forEach((rawGid, i) => {
                const gid = normalizeGid(rawGid);
                if (gid === 0) return;

                const tileset = findTilesetForGid(gid);
                if (!tileset) return;

                const localIndex = gid - tileset.firstgid;
                if (localIndex < 0) return;
                if (Number.isFinite(tileset.tilecount) && localIndex >= tileset.tilecount) return;

                const col = i % roomData.width;
                const row = Math.floor(i / roomData.width);

                // Source rectangle inside this tileset image
                const srcX = tileset.margin + (localIndex % tileset.tilesPerRow) * (tileset.tilewidth + tileset.spacing);
                const srcY = tileset.margin + Math.floor(localIndex / tileset.tilesPerRow) * (tileset.tileheight + tileset.spacing);

                let tileTexture = textureCache.get(gid);
                if (!tileTexture) {
                    tileTexture = new PIXI.Texture({
                        source: tileset.source,
                        frame: new PIXI.Rectangle(srcX, srcY, tileset.tilewidth, tileset.tileheight),
                    });
                    textureCache.set(gid, tileTexture);
                }

                const sprite = new PIXI.Sprite({
                    texture: tileTexture,
                    textureStyle: {
                        scaleMode: "nearest",
                    },
                });

                // Position in world uses the MAP tile size
                sprite.x = col * TILE_SIZE + offsetX;
                sprite.y = row * TILE_SIZE + offsetY;

                // Top-down depth: sort by the *bottom edge* of the tile (not the top-left).
                // This allows the character's head to go behind walls while feet stay in front.
                sprite.zIndex = sprite.y + TILE_SIZE + zBias;

                worldContainer.addChild(sprite);
            });
        });

    // --- Collision Layers ---
    // Support multiple collidable layers (e.g., Outerwall + Insidewall)
    const collisionLayers = roomData.layers.filter(
        (layer) =>
            layer.type === "tilelayer" &&
            (String(layer.name || "").toLowerCase() === "collision" ||
                layer.properties?.some((p) => p.name === "collision" && p.value === true))
    );

    const collisionMap = new Set();
    collisionLayers.forEach((layer) => {
        layer.data.forEach((gid, index) => {
            if (normalizeGid(gid) !== 0) collisionMap.add(index);
        });
    });

    // --- Collision Objects (Object Layers) ---
    // Support collidable object layers (e.g., "interactables" as objectgroup)
    const collisionObjectLayers = roomData.layers.filter(
        (layer) =>
            layer.type === "objectgroup" &&
            layer.properties?.some((p) => p.name === "collision" && p.value === true)
    );

    // We collide only with the "base" of objects so the avatar head can overlap visually.
    // (Tiled: tile objects have y at the bottom; shapes typically use y as top.)
    const collisionRects = [];
    collisionObjectLayers.forEach((layer) => {
        (layer.objects || []).forEach((obj) => {
            if (obj.visible === false) return;

            const ox = obj.x ?? 0;
            const oy = obj.y ?? 0;
            const w = obj.width ?? TILE_SIZE;
            const h = obj.height ?? TILE_SIZE;

            // If this is a tile object (has gid), Tiled uses y as the bottom.
            // Otherwise (rect/poly), y is typically the top.
            const topY = obj.gid ? oy - h : oy;

            // Full object collider (at least as big as the object). Add a small padding to feel less "clip-y".
            const pad = 2;

            collisionRects.push({
                x: ox - pad,
                y: topY - pad,
                w: w + pad * 2,
                h: h + pad * 2,
            });
        });
    });

    // Function to check collision at given pixel coordinate
    const checkCollision = (x, y) => {
        const col = Math.floor(x / TILE_SIZE);
        const row = Math.floor(y / TILE_SIZE);

        // Treat outside map as blocked so the player can't walk out of bounds
        if (col < 0 || row < 0 || col >= roomData.width || row >= roomData.height) return true;

        const index = row * roomData.width + col;
        if (collisionMap.has(index)) return true;

        // Object-layer collision (interactables, etc.)
        for (let i = 0; i < collisionRects.length; i++) {
            const r = collisionRects[i];
            if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return true;
        }

        return false;
    };

    return { worldContainer, checkCollision, TILE_SIZE, mapWidth, mapHeight, collisionRects };
}