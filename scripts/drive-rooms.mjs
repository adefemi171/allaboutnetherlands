import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { motionBlocked, vehiclesOverlap } from "../src/drive/vehicle-contact.ts";

const ROOM = /^[a-z0-9-]{3,32}$/;
const COLOR = /^#[0-9a-f]{6}$/i;
const ROOM_CAPACITY = 12;
const MAX_CONNECTIONS = 96;

const roadPose = ([x, z, angle]) => ({ point: [x, z], angle });

function decodeState(data, bounds) {
  if (data === null) return null;
  if (!Array.isArray(data) || data.length !== 4) return undefined;
  const [x, z, angle, color] = data;
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(angle)
    || x < 0 || z < 0 || x > bounds[0] || z > bounds[1] || Math.abs(angle) > 7
    || typeof color !== "string" || !COLOR.test(color)) return undefined;
  return [x, z, angle, color.toLowerCase()];
}

export function attachDriveRooms(server, areas) {
  const boundsByArea = Array.isArray(areas) ? { utrecht: areas } : areas;
  const relay = new WebSocketServer({ noServer: true, maxPayload: 256, perMessageDeflate: false });
  const rooms = new Map();
  function upgrade(request, socket, head) {
    if (!request.url?.startsWith("/drive/socket")) return;
    const url = new URL(request.url, "http://localhost");
    if (url.pathname !== "/drive/socket") return;
    const room = url.searchParams.get("room") ?? "";
    const area = url.searchParams.get("area") ?? "utrecht";
    const bounds = Object.hasOwn(boundsByArea, area) ? boundsByArea[area] : null;
    const roomKey = `${area}:${room}`;
    const expectedOrigin = request.headers.origin;
    const host = request.headers.host;
    if (!bounds || !ROOM.test(room) || ![`http://${host}`, `https://${host}`].includes(expectedOrigin)) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    relay.handleUpgrade(request, socket, head, (ws) => {
      const peers = rooms.get(roomKey) ?? new Map();
      if (peers.size >= ROOM_CAPACITY || relay.clients.size > MAX_CONNECTIONS) {
        ws.close(1013, "Room is full");
        return;
      }
      rooms.set(roomKey, peers);
      const id = randomUUID();
      const peer = { state: null, received: 0, alive: true, ws };
      peers.set(id, peer);
      ws.send(JSON.stringify({ id }));
      ws.on("error", () => ws.terminate());
      ws.on("pong", () => { peer.alive = true; });
      ws.on("message", (payload, binary) => {
        const now = Date.now();
        if (binary || now - peer.received < 45) return;
        peer.received = now;
        try {
          const state = decodeState(JSON.parse(payload.toString()), bounds);
          if (state === undefined) return;
          if (state === null) {
            peer.state = null;
            return;
          }
          const occupied = (pose) => {
            for (const other of peers.values()) {
              if (other !== peer && other.state && vehiclesOverlap(pose, roadPose(other.state))) return true;
            }
            return false;
          };
          if (motionBlocked(peer.state && roadPose(peer.state), roadPose(state), occupied)) {
            if (peer.state) ws.send(JSON.stringify({ blocked: [state.slice(0, 2), peer.state.slice(0, 3)] }));
            return;
          }
          peer.state = state;
        } catch { /* Ignore malformed state packets. */ }
      });
      ws.on("close", () => {
        peers.delete(id);
        if (!peers.size) rooms.delete(roomKey);
      });
    });
  }

  server.on("upgrade", upgrade);
  const send = setInterval(() => {
    for (const peers of rooms.values()) {
      const cars = [...peers].flatMap(([id, peer]) => peer.state ? [[id, ...peer.state]] : []);
      const packet = JSON.stringify({ players: peers.size, cars });
      for (const { ws } of peers.values()) {
        if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 12_000) ws.send(packet);
      }
    }
  }, 100);
  const heartbeat = setInterval(() => {
    for (const room of rooms.values()) for (const peer of room.values()) {
      if (!peer.alive) peer.ws.terminate();
      else {
        peer.alive = false;
        peer.ws.ping();
      }
    }
  }, 20_000);
  const close = () => {
    clearInterval(send);
    clearInterval(heartbeat);
    server.off("upgrade", upgrade);
    for (const client of relay.clients) client.terminate();
    relay.close();
  };
  server.once("close", close);
}

export function driveRooms(bounds) {
  const start = (server) => {
    if (server.httpServer) attachDriveRooms(server.httpServer, bounds);
  };
  return { name: "drive-rooms", configureServer: start, configurePreviewServer: start };
}
