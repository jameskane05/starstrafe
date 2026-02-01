import {
    defineServer,
    defineRoom,
    monitor,
    playground,
    createRouter,
    createEndpoint,
    matchMaker,
} from "colyseus";

/**
 * Import your Room files
 */
import { MyRoom } from "./rooms/MyRoom.js";
import { GameRoom } from "./rooms/GameRoom.js";

const server = defineServer({
    /**
     * Define your room handlers:
     */
    rooms: {
        my_room: defineRoom(MyRoom),
        game_room: defineRoom(GameRoom),
    },

    /**
     * Experimental: Define API routes. Built-in integration with the "playground" and SDK.
     * 
     * Usage from SDK: 
     *   client.http.get("/api/hello").then((response) => {})
     * 
     */
    routes: createRouter({
        api_hello: createEndpoint("/api/hello", { method: "GET", }, async (ctx) => {
            return { message: "Hello World" }
        }),
        api_rooms: createEndpoint("/api/rooms", { method: "GET", }, async () => {
            const rooms = await matchMaker.query({ name: "game_room" });
            return rooms.map(room => ({
                roomId: room.roomId,
                name: room.name,
                clients: room.clients,
                maxClients: room.maxClients,
                metadata: room.metadata
            }));
        }),
        api_check_room: createEndpoint("/api/check-room/:roomId", { method: "GET", }, async (ctx) => {
            const roomId = ctx.params.roomId;
            const rooms = await matchMaker.query({ name: "game_room" });
            const exists = rooms.some(room => room.roomId.toUpperCase() === roomId.toUpperCase());
            return { exists };
        })
    }),

    /**
     * Bind your custom express routes here:
     * Read more: https://expressjs.com/en/starter/basic-routing.html
     */
    express: (app) => {
        app.get("/hi", (req, res) => {
            res.send("It's time to kick ass and chew bubblegum!");
        });

        /**
         * Use @colyseus/monitor
         * It is recommended to protect this route with a password
         * Read more: https://docs.colyseus.io/tools/monitoring/#restrict-access-to-the-panel-using-a-password
         */
        app.use("/monitor", monitor());

        /**
         * Use @colyseus/playground
         * (It is not recommended to expose this route in a production environment)
         */
        if (process.env.NODE_ENV !== "production") {
            app.use("/", playground());
        }
    }

});

export default server;