import { db } from "@server/db";
import { MessageHandler } from "../ws";
import { clients, Olm } from "@server/db";
import { eq, lt, isNull } from "drizzle-orm";
import logger from "@server/logger";

// Track if the offline checker interval is running
let offlineCheckerInterval: NodeJS.Timeout | null = null;
const OFFLINE_CHECK_INTERVAL = 30 * 1000; // Check every 30 seconds
const OFFLINE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Starts the background interval that checks for clients that haven't pinged recently
 * and marks them as offline
 */
export const startOfflineChecker = (): void => {
    if (offlineCheckerInterval) {
        return; // Already running
    }

    offlineCheckerInterval = setInterval(async () => {
        try {
            const twoMinutesAgo = new Date(Date.now() - OFFLINE_THRESHOLD_MS);

            // Find clients that haven't pinged in the last 2 minutes and mark them as offline
            await db
                .update(clients)
                .set({ online: false })
                .where(
                    eq(clients.online, true) &&
                    (lt(clients.lastPing, twoMinutesAgo.toISOString()) || isNull(clients.lastPing))
                );

        } catch (error) {
            logger.error("Error in offline checker interval", { error });
        }
    }, OFFLINE_CHECK_INTERVAL);

    logger.info("Started offline checker interval");
}

/**
 * Stops the background interval that checks for offline clients
 */
export const stopOfflineChecker = (): void => {
    if (offlineCheckerInterval) {
        clearInterval(offlineCheckerInterval);
        offlineCheckerInterval = null;
        logger.info("Stopped offline checker interval");
    }
}

/**
 * Handles ping messages from clients and responds with pong
 */
export const handleOlmPingMessage: MessageHandler = async (context) => {
    const { message, client: c, sendToClient } = context;
    const olm = c as Olm;

    if (!olm) {
        logger.warn("Olm not found");
        return;
    }

    if (!olm.clientId) {
        logger.warn("Olm has no client ID!");
        return;
    }

    try {
        // Update the client's last ping timestamp
        await db
            .update(clients)
            .set({
                lastPing: new Date().toISOString(),
                online: true,
            })
            .where(eq(clients.clientId, olm.clientId));
    } catch (error) {
        logger.error("Error handling ping message", { error });
    }

    return {
        message: {
            type: "pong",
            data: {
                timestamp: new Date().toISOString(),
            }
        },
        broadcast: false,
        excludeSender: false
    };
};
