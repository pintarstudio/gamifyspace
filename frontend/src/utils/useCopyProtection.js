import {useEffect} from "react";

export default function useCopyProtection(enabled, onBlocked, message = "Menyalin konten aktivitas tidak diizinkan.") {
    useEffect(() => {
        if (!enabled) return undefined;

        const blockCopyAction = (event) => {
            event.preventDefault();
            onBlocked?.(message);
        };

        window.addEventListener("copy", blockCopyAction);
        window.addEventListener("cut", blockCopyAction);
        window.addEventListener("contextmenu", blockCopyAction);
        window.addEventListener("dragstart", blockCopyAction);

        return () => {
            window.removeEventListener("copy", blockCopyAction);
            window.removeEventListener("cut", blockCopyAction);
            window.removeEventListener("contextmenu", blockCopyAction);
            window.removeEventListener("dragstart", blockCopyAction);
        };
    }, [enabled, message, onBlocked]);
}
