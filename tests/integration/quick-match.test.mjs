import assert from 'node:assert/strict';
import test from 'node:test';
import Photon from 'photon-realtime';
import { RaidRoom } from '../../src/platform/photon/raid-room.ts';

// Drive the SDK membership callbacks in the order seen by one browser, without a server.
function peer(t, self = 1) {
  const Client = Photon.LoadBalancing.LoadBalancingClient;
  let client;
  let members = [1, 2, 3];
  t.mock.method(Client.prototype, 'connectToRegionMaster', function () {
    client = this;
    return true;
  });
  const waiting = t.mock.fn();
  const lobby = t.mock.fn();
  const start = t.mock.fn();
  const room = new RaidRoom('test', '', 'quick', { waiting, lobby, start });
  t.after(() => room.close());
  client.myActor = () => ({ actorNr: self });
  client.myRoomActorsArray = () => members.map((actorNr) => ({ actorNr }));
  client.myRoomMasterActorNr = () => members[0];
  client.raiseEvent = t.mock.fn();
  client.disconnect = t.mock.fn();
  client.onJoinRoom();
  return {
    room,
    client,
    waiting,
    lobby,
    start,
    join(actorNr) {
      members.push(actorNr);
      client.onActorJoin({ actorNr });
    },
    leave(actorNr) {
      members = members.filter((id) => id !== actorNr);
      client.onActorLeave({ actorNr });
    },
  };
}

test('three queued players cannot pick or start, and a replacement gets a fresh draft', (t) => {
  const { room, client, waiting, lobby, start, join, leave } = peer(t);
  assert.deepEqual(waiting.mock.calls[0].arguments, [3]);
  room.prefer('hammer');
  room.pick('hammer');
  room.start();
  assert.equal(lobby.mock.callCount(), 0);
  assert.equal(start.mock.callCount(), 0);
  assert.equal(client.raiseEvent.mock.callCount(), 0);

  join(4);
  const firstTurn = lobby.mock.calls.at(-1).arguments;
  assert.deepEqual(
    firstTurn[0].map((s) => s.actor),
    [1, 2, 3, 4],
  );
  assert.equal(firstTurn[3].actor, 1);
  room.pick('hammer');
  assert.equal(lobby.mock.calls.at(-1).arguments[0][0].hero, 'hammer');
  leave(3);
  assert.deepEqual(waiting.mock.calls.at(-1).arguments, [3]);
  join(5);
  assert.ok(lobby.mock.calls.at(-1).arguments[0].every((s) => s.hero === null));
  assert.equal(lobby.mock.calls.at(-1).arguments[3].actor, 1);
  const calls = lobby.mock.callCount();
  client.onEvent(17, JSON.stringify({ lineup: '1,2,3,4', value: { hero: 'jade' } }), 2);
  assert.equal(lobby.mock.callCount(), calls);
});

test('a peer ignores delayed draft snapshots from the group that lost its fourth player', (t) => {
  const { client, lobby, join, leave } = peer(t, 2);
  const packet = (actors) =>
    JSON.stringify({
      seats: actors.map((actor) => ({ actor, hero: null })),
      turn: 1,
      remaining: 18000,
    });
  const first = packet([1, 2, 3, 4]);
  join(4);
  client.onEvent(14, first, 1);
  assert.equal(lobby.mock.callCount(), 1);
  leave(4);
  client.onEvent(14, first, 1);
  join(5);
  client.onEvent(14, first, 1);
  assert.equal(lobby.mock.callCount(), 1);
  client.onEvent(14, packet([1, 2, 3, 5]), 1);
  assert.equal(lobby.mock.callCount(), 2);
});
