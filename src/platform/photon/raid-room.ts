import Photon from 'photon-realtime';
import {
  readDraftChoice,
  nextDraftClock,
  readDraftSnapshot,
  timeoutPick,
  isRaidRoster,
  applyTurnPick,
  draftMembers,
  draftMessage,
  draftTeammates,
  type DraftSeat,
  type DraftClock,
  type RaidSeat,
} from '../../game/raid/raid-draft.ts';
import type { RaidCommandName } from '../../game/raid/raid-feature.ts';
import type { RaidHero } from '../../game/raid/raid-match.ts';

const Client = Photon.LoadBalancing.LoadBalancingClient;
// The npm distribution defaults to its Node ws adapter. Browsers use native WSS.
Photon.PhotonPeer.setWebSocketImpl(WebSocket);
// Replaying approved inputs requires every peer to use the same combat rules.
const version = 'run-and-raid-13';
const event = {
  start: 10,
  intent: 11,
  frames: 12,
  pick: 13,
  draft: 14,
  syncDraft: 15,
  chat: 16,
  prefer: 17,
} as const;
export type RoomError = 'connectError' | 'roomUnavailable' | 'roomEnded' | 'syncError';
export type RaidEntry = 'host' | 'join' | 'quick';
interface Callbacks {
  waiting(count: number): void;
  chat(actor: number, text: string): void;
  lobby(seats: DraftSeat[], self: number, host: boolean, clock: DraftClock | null): void;
  start(seats: RaidSeat[], self: number, host: boolean): void;
  solo(hero: RaidHero, outfit?: string): void;
  intent(sender: number, data: unknown): void;
  frames(data: unknown): void;
  closed(reason: RoomError): void;
}
export class RaidRoom {
  readonly #client: InstanceType<typeof Client>;
  readonly #callbacks: Callbacks;
  readonly #entry: RaidEntry;
  #closed = false;
  #joined = false;
  #host = 0;
  #roster: RaidSeat[] = [];
  #draft: DraftSeat[] = [];
  #clock: DraftClock | null = null;
  #draftTimer: ReturnType<typeof setTimeout> | undefined;
  #seq = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  constructor(appId: string, code: string, entry: RaidEntry, callbacks: Callbacks) {
    this.#callbacks = callbacks;
    this.#entry = entry;
    const client = new Client(Photon.ConnectionProtocol.Wss, appId, version);
    this.#client = client;
    client.setLogLevel(0);
    client.onStateChange = (state) => {
      if (this.#closed) return;
      if (state === Client.State.JoinedLobby && !this.#joined) {
        if (entry === 'quick') {
          // Photon fills a public room or creates one atomically. Code rooms stay unlisted.
          if (
            !client.joinRandomOrCreateRoom({ expectedMaxPlayers: 4 }, '', {
              maxPlayers: 4,
              isVisible: true,
            })
          )
            this.fail('connectError');
        } else if (entry === 'host')
          client.createRoom('raid-' + code, { maxPlayers: 4, isVisible: false });
        else client.joinRoom('raid-' + code);
      } else if (state === Client.State.Disconnected || state === Client.State.Error)
        this.fail('connectError');
    };
    client.onJoinRoom = () => {
      if (this.#closed) return;
      this.#joined = true;
      clearTimeout(this.#timer);
      this.#membershipChanged(true);
    };
    client.onActorJoin = (actor) => {
      // A join already in flight can arrive while the master closes the room.
      if (
        this.host &&
        this.#roster.length &&
        !this.#roster.some((seat) => seat.actor === actor.actorNr)
      )
        client.raiseEvent(event.start, JSON.stringify(this.#roster), {
          targetActors: [actor.actorNr],
        });
      else this.#membershipChanged();
    };
    client.onActorLeave = (actor) => {
      if (this.#roster.some((s) => s.actor === actor.actorNr)) this.fail('roomEnded');
      else this.#membershipChanged();
    };
    client.onError = () => this.fail('connectError');
    client.onOperationResponse = (error, _msg, op) => {
      if (error && (op === 225 || op === 226 || op === 227)) this.fail('roomUnavailable');
    };
    client.onEvent = (code, raw, sender) => {
      if (
        this.#closed ||
        !this.#joined ||
        typeof raw !== 'string' ||
        raw.length > (code === event.intent ? 512 : 64000)
      )
        return;
      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch {
        return;
      }
      if (!this.#roster.length) {
        if (code === event.pick || code === event.prefer || code === event.chat) {
          // A late command from a dissolved quick match must not affect its replacement.
          if (!data || typeof data !== 'object' || !('lineup' in data) || !('value' in data))
            return;
          const lineup = this.#lineup();
          if (lineup === undefined || data.lineup !== lineup) return;
          data = data.value;
        }
        if (code === event.chat) {
          const text = draftMessage(data);
          if (text && draftTeammates(this.#members(), this.self).includes(sender))
            callbacks.chat(sender, text);
          return;
        }
        const master = client.myRoomMasterActorNr();
        if (
          this.self === master &&
          (code === event.pick || code === event.prefer || code === event.syncDraft)
        ) {
          this.#lobby(code, sender, data);
          return;
        }
        if (code === event.draft && sender === master && this.self !== master) {
          const snapshot = readDraftSnapshot(data, performance.now());
          if (
            !snapshot ||
            !snapshot.seats.some((s) => s.actor === this.self) ||
            !this.#includesQuickGroup(snapshot.seats)
          )
            return;
          this.#draft = snapshot.seats;
          this.#clock = snapshot.clock;
          callbacks.lobby(this.#draft, this.self, false, this.#clock);
          return;
        }
      }
      if (code === event.start && !this.#roster.length && sender === client.myRoomMasterActorNr()) {
        if (
          !isRaidRoster(data) ||
          !this.#includesQuickGroup(data) ||
          !data.some((s) => s.actor === this.self) ||
          !data.some((s) => s.actor === sender)
        )
          this.fail('roomUnavailable');
        else this.#begin(data, sender);
      } else if (this.#roster.length && code === event.intent && this.host)
        callbacks.intent(sender, data);
      else if (this.#roster.length && code === event.frames && sender === this.#host && !this.host)
        callbacks.frames(data);
    };
    this.#timer = setTimeout(() => this.fail('connectError'), 18000);
    if (!client.connectToRegionMaster('asia')) queueMicrotask(() => this.fail('connectError'));
  }
  get self() {
    return this.#client.myActor().actorNr;
  }
  get host() {
    return this.self === this.#host;
  }
  #members() {
    return draftMembers(
      this.#draft,
      this.#client.myRoomActorsArray().map((a) => a.actorNr),
    );
  }
  #includesQuickGroup(seats: DraftSeat[]) {
    if (this.#entry !== 'quick') return true;
    const actors = this.#client.myRoomActorsArray();
    return (
      seats.length === 4 &&
      actors.length === 4 &&
      actors.every((a) => seats.some((s) => s.actor === a.actorNr))
    );
  }
  #lineup() {
    if (this.#entry !== 'quick') return '';
    if (this.#includesQuickGroup(this.#draft)) return this.#draft.map((s) => s.actor).join(',');
    return undefined;
  }
  #membershipChanged(joined = false) {
    if (this.#closed || !this.#joined || this.#roster.length) return;
    const count = this.#client.myRoomActorsArray().length;
    if (this.#entry === 'quick' && count < 4) {
      clearTimeout(this.#draftTimer);
      this.#draft = [];
      this.#clock = null;
      this.#callbacks.waiting(count);
      return;
    }
    const master = this.#client.myRoomMasterActorNr();
    if (this.self === master) this.#lobby();
    else if (joined || this.#entry === 'quick')
      this.#client.raiseEvent(event.syncDraft, 'null', { targetActors: [master] });
  }
  #lobby(code?: number, sender?: number, data?: unknown) {
    if (
      !this.#joined ||
      this.#roster.length ||
      this.#closed ||
      this.self !== this.#client.myRoomMasterActorNr()
    )
      return;
    const members = this.#members();
    if (this.#entry === 'quick' && members.length !== 4) return;
    clearTimeout(this.#draftTimer);
    this.#draft = members;
    const now = performance.now();
    this.#clock = nextDraftClock(this.#draft, this.#clock, now);
    if (this.#clock && now >= this.#clock.endsAt) {
      if (this.#clock.actor === null) {
        this.start();
        return;
      }
      timeoutPick(this.#draft, this.#clock.actor);
      this.#clock = nextDraftClock(this.#draft, this.#clock, now);
    }
    const seat = this.#draft.find((s) => s.actor === sender);
    const choice = readDraftChoice(data);
    if (seat && code === event.prefer && !seat.hero && choice) {
      seat.preferred = choice.hero;
      seat.outfit = choice.outfit;
    }
    if (seat && code === event.pick && (data === null || choice))
      applyTurnPick(this.#draft, this.#clock, seat.actor, choice?.hero ?? null, choice?.outfit);
    this.#clock = nextDraftClock(this.#draft, this.#clock, now);
    const remaining = this.#clock ? Math.max(0, this.#clock.endsAt - now) : null;
    if (remaining !== null)
      this.#draftTimer = setTimeout(() => this.#lobby(), Math.ceil(remaining));
    this.#client.raiseEvent(
      event.draft,
      JSON.stringify({ seats: this.#draft, turn: this.#clock?.actor ?? null, remaining }),
    );
    this.#callbacks.lobby(this.#draft, this.self, true, this.#clock);
  }
  #choose(code: number, hero: RaidHero | null, outfit?: string) {
    if (!this.#joined || this.#roster.length || this.#closed) return;
    const lineup = this.#lineup();
    if (lineup === undefined) return;
    const master = this.#client.myRoomMasterActorNr();
    const choice = hero === null ? null : { hero, outfit };
    if (this.self === master) this.#lobby(code, this.self, choice);
    else
      this.#client.raiseEvent(code, JSON.stringify({ lineup, value: choice }), {
        targetActors: [master],
      });
  }
  pick(hero: RaidHero | null, outfit?: string) {
    this.#choose(event.pick, hero, outfit);
  }
  prefer(hero: RaidHero, outfit?: string) {
    this.#choose(event.prefer, hero, outfit);
  }
  chat(value: string) {
    const text = draftMessage(value);
    if (!text || !this.#joined || this.#closed || this.#roster.length) return;
    const lineup = this.#lineup();
    if (lineup === undefined) return;
    const targetActors = draftTeammates(this.#members(), this.self);
    if (targetActors.length)
      this.#client.raiseEvent(event.chat, JSON.stringify({ lineup, value: text }), {
        targetActors,
      });
    this.#callbacks.chat(this.self, text);
  }
  start() {
    if (
      !this.#joined ||
      this.#closed ||
      this.#roster.length ||
      this.self !== this.#client.myRoomMasterActorNr()
    )
      return;
    const seats = this.#members();
    const only = seats[0];
    if (this.#entry !== 'quick' && seats.length === 1 && only?.actor === this.self && only.hero) {
      this.#client.myRoom().setIsOpen(false);
      this.close();
      this.#callbacks.solo(only.hero, only.outfit);
      return;
    }
    if (!isRaidRoster(seats) || !this.#includesQuickGroup(seats)) return;
    this.#client.myRoom().setIsOpen(false);
    this.#client.raiseEvent(event.start, JSON.stringify(seats));
    this.#begin(seats, this.self);
  }
  #begin(roster: RaidSeat[], host: number) {
    clearTimeout(this.#draftTimer);
    this.#roster = roster;
    this.#host = host;
    this.#callbacks.start(roster, this.self, this.host);
  }
  order(action: RaidCommandName, payload?: unknown) {
    if (this.#closed || !this.#roster.length) return false;
    const data = { seq: ++this.#seq, action, payload };
    if (this.host) this.#callbacks.intent(this.self, data);
    else
      this.#client.raiseEvent(event.intent, JSON.stringify(data), { targetActors: [this.#host] });
    return true;
  }
  frames(batch: unknown) {
    if (this.host && !this.#closed) this.#client.raiseEvent(event.frames, JSON.stringify(batch));
  }
  fail(reason: RoomError) {
    if (this.#closed) return;
    this.close();
    this.#callbacks.closed(reason);
  }
  close() {
    if (this.#closed) return;
    this.#closed = true;
    clearTimeout(this.#timer);
    clearTimeout(this.#draftTimer);
    this.#client.disconnect();
  }
}
