import { APP_ID, PROTOCOL, SIM_VERSION } from '../game/rules.js'

/**
 * Peer transport used by the lobby.
 * To move off public relays, replace this module with another that returns
 * the same { selfId, send, sendTo, peers, leave } shape. Both players have
 * to use the same strategy (Nostr, MQTT, Firebase, or a hosted relay).
 *
 * Messages are envelopes `{ v, sim, type, ... }`. Unknown `type` values are
 * ignored by the session so optional messages can be added later.
 */
export async function openRoom(code, handlers) {
  const { joinRoom, selfId } = await import('trystero')
  const room = joinRoom(
    {
      appId: APP_ID,
      relayConfig: { redundancy: 4, warnOnRelayFailure: false },
    },
    `cf-${code}`,
    {
      handshakeTimeoutMs: 15000,
      onJoinError() {
        handlers.onStatus?.('Still trying to link the two browsers.')
      },
    },
  )
  const channel = room.makeAction('game')
  channel.onMessage = (data, meta) => handlers.onMessage?.(data, meta.peerId)
  room.onPeerJoin = (peerId) => handlers.onPeer?.('join', peerId)
  room.onPeerLeave = (peerId) => handlers.onPeer?.('leave', peerId)

  function envelope(data) {
    return { v: PROTOCOL, sim: SIM_VERSION, ...data }
  }

  return {
    selfId,
    send(data) {
      return channel.send(envelope(data))
    },
    sendTo(peerId, data) {
      return channel.send(envelope(data), { target: peerId })
    },
    peers() {
      return Object.keys(room.getPeers())
    },
    leave() {
      return room.leave()
    },
  }
}
