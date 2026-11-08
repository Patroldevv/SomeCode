import { describe, expect, it, vi } from 'vitest';
import { createConnection, type SocketLike } from './connection.ts';
import { bindSessionClient } from './sessionClient.ts';
import { createSessionsStore, type Schedule } from './sessionsStore.ts';
import {initialState} from './sessionState.ts';

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    this.readyState = 3;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  drop(): void {
    this.readyState = 3;
    this.onclose?.({});
  }
  receive(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

const agentEvent = (sessionId: string, seq: number, text = 'x') => ({
  type: 'event',
  stored: { seq, sessionId, ts: 0, event: { type: 'agent_message', text } },
});

function setup(restoredId: string | null, schedule?: Schedule) {
  const sockets: FakeSocket[] = [];
  const conn = createConnection({
    url: 'ws://h/ws',
    token: 't',
    createSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
  });
  const store = createSessionsStore(schedule ? { schedule } : {});
  const onError = vi.fn();
  const onRestoreFailed = vi.fn();
  const restoring = { current: restoredId };
  const client = bindSessionClient(conn, { store, restoring, active: restoredId, onError, onRestoreFailed });
  const socket = sockets[0]!;
  return { conn, store, socket, sockets, client, onError, onRestoreFailed, restoring };
}

describe('bindSessionClient', () => {
  it('does not redisplay an older page when its request completes after returning to recent', async () => {
    const {conn,client:oldClient,store}=setup('s1');
    oldClient.dispose();
    store.setSnapshot('s1',{state:{...initialState(),lastSeq:50,items:[{kind:'user',key:'40',text:'recent'}]},beforeSeq:40});
    let resolve!: (value: import('@somecode/protocol').SessionHistoryPage)=>void;
    const client=bindSessionClient(conn,{store,restoring:{current:null},active:'s1',onError:()=>{},onRestoreFailed:()=>{},loadHistory:()=>new Promise((done)=>{resolve=done;})});
    const pending=client.loadOlder('s1');
    client.showRecent('s1');
    expect(store.get('s1').historyLoading).toBe(false);
    resolve({state:{...initialState(),lastSeq:50,items:[{kind:'user',key:'1',text:'old'}]},beforeSeq:null});
    await pending;
    expect(store.get('s1').olderItems??[]).toEqual([]);
    client.dispose();
  });
  it('clears history loading when the connection binding is disposed', async () => {
    const {conn,client:oldClient,store}=setup('s1');
    oldClient.dispose();
    store.setSnapshot('s1',{state:{...initialState(),lastSeq:50,items:[]},beforeSeq:40});
    let resolve!: (value: import('@somecode/protocol').SessionHistoryPage)=>void;
    const client=bindSessionClient(conn,{store,restoring:{current:null},active:'s1',onError:()=>{},onRestoreFailed:()=>{},loadHistory:()=>new Promise((done)=>{resolve=done;})});
    const pending=client.loadOlder('s1');
    expect(store.get('s1').historyLoading).toBe(true);
    client.dispose();
    expect(store.get('s1').historyLoading).toBe(false);
    resolve({state:initialState(),beforeSeq:null});
    await pending;
  });
  it('accepts a normalized snapshot then reconnects from its live cursor', () => {
    const {socket,store,sockets}=setup('s1');
    socket.open();
    socket.receive({type:'snapshot',sessionId:'s1',history:{state:{...initialState(),lastSeq:500,items:[{kind:'user',key:'450',text:'recent'}]},beforeSeq:450}});
    expect(store.get('s1').lastSeq).toBe(500);
    expect(store.get('s1').olderBeforeSeq).toBe(450);
    vi.useFakeTimers(); socket.drop(); vi.advanceTimersByTime(1000); vi.useRealTimers();
    sockets[1]!.open();
    expect(sockets[1]!.sent).toEqual([{type:'subscribe',sessionId:'s1',afterSeq:500}]);
  });
  it('loads one older page while keeping live events received during the request', async () => {
    const {conn,client:oldClient,store,socket}=setup('s1');
    oldClient.dispose();
    store.setSnapshot('s1',{state:{...initialState(),lastSeq:50,items:[{kind:'user',key:'40',text:'recent'}]},beforeSeq:40});
    let resolve!: (value: import('@somecode/protocol').SessionHistoryPage)=>void;
    const client=bindSessionClient(conn,{store,restoring:{current:null},active:'s1',onError:()=>{},onRestoreFailed:()=>{},loadHistory:()=>new Promise((done)=>{resolve=done;})});
    socket.open();
    const pending=client.loadOlder('s1');
    socket.receive(agentEvent('s1',51,'live'));
    resolve({state:{...initialState(),lastSeq:50,items:[{kind:'user',key:'1',text:'old'}]},beforeSeq:null});
    await pending;
    expect(store.get('s1').lastSeq).toBe(51);
    expect(store.get('s1').olderItems).toMatchObject([{text:'old'}]);
    expect(store.get('s1').items).toMatchObject([{text:'recent'},{text:'live'}]);
    client.dispose();
  });
  it('applies late tool patches that arrived while an older page was loading', async () => {
    const {conn,client:oldClient,store,socket}=setup('s1');
    oldClient.dispose();
    store.setSnapshot('s1',{state:{...initialState(),lastSeq:50,items:[{kind:'user',key:'40',text:'recent'}]},beforeSeq:40});
    let resolve!: (value: import('@somecode/protocol').SessionHistoryPage)=>void;
    const client=bindSessionClient(conn,{store,restoring:{current:null},active:'s1',onError:()=>{},onRestoreFailed:()=>{},loadHistory:()=>new Promise((done)=>{resolve=done;})});
    socket.open();
    const pending=client.loadOlder('s1');
    socket.receive({type:'event',stored:{sessionId:'s1',seq:51,ts:0,event:{type:'tool_call_update',id:'old-tool',patch:{status:'completed'}}}});
    resolve({state:{...initialState(),lastSeq:50,items:[{kind:'tool',key:'1',id:'old-tool',title:'Read',toolKind:'read',content:[],status:'pending'}]},beforeSeq:null});
    await pending;
    expect(store.get('s1').olderItems).toMatchObject([{kind:'tool',status:'completed'}]);
    expect(store.get('s1').lastSeq).toBe(51);
    client.dispose();
  });
  it('subscribes to the restored session from seq 0 once the socket opens', () => {
    const { socket } = setup('s1');
    expect(socket.sent).toEqual([]);
    socket.open();
    expect(socket.sent).toEqual([{ type: 'subscribe', sessionId: 's1', afterSeq: 0 }]);
  });

  it('sends nothing without a restored session', () => {
    const { socket } = setup(null);
    socket.open();
    expect(socket.sent).toEqual([]);
  });

  it('applies events to the store of their own session', () => {
    const { socket, store } = setup('s1');
    socket.open();
    socket.receive(agentEvent('s1', 1, 'hello'));
    socket.receive(agentEvent('s2', 1, 'other'));
    expect(store.get('s1').items).toMatchObject([{ kind: 'agent', text: 'hello' }]);
    expect(store.get('s2').items).toMatchObject([{ kind: 'agent', text: 'other' }]);
  });

  it('activating a session resumes from the store lastSeq (switching back does not replay)', () => {
    const { socket, client } = setup(null);
    socket.open();
    client.activate('s1');
    socket.receive(agentEvent('s1', 1));
    socket.receive(agentEvent('s1', 2));
    client.activate('s2');
    client.activate('s1');
    expect(socket.sent).toEqual([
      { type: 'subscribe', sessionId: 's1', afterSeq: 0 },
      { type: 'unsubscribe', sessionId: 's1' },
      { type: 'subscribe', sessionId: 's2', afterSeq: 0 },
      { type: 'unsubscribe', sessionId: 's2' },
      { type: 'subscribe', sessionId: 's1', afterSeq: 2 },
    ]);
  });

  it('a not_found while restoring quietly forgets the restored session', () => {
    const { socket, sockets, onError, onRestoreFailed, restoring } = setup('gone');
    socket.open();
    socket.receive({ type: 'error', code: 'not_found', message: 'unknown session' });
    expect(onRestoreFailed).toHaveBeenCalledExactlyOnceWith('gone');
    expect(onError).not.toHaveBeenCalled();
    expect(restoring.current).toBeNull();
    // Forgotten: a reconnect no longer re-subscribes to it.
    vi.useFakeTimers();
    socket.drop();
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();
    sockets[1]!.open();
    expect(sockets[1]!.sent).toEqual([]);
  });

  it('once subscribed, a later not_found is an ordinary error', () => {
    const { socket, onError, onRestoreFailed } = setup('s1');
    socket.open();
    socket.receive({ type: 'subscribed', sessionId: 's1', lastSeq: 0 });
    socket.receive({ type: 'error', code: 'not_found', message: 'x' });
    expect(onRestoreFailed).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledExactlyOnceWith('not_found');
  });

  it('activating another session ends the restore, so its not_found is shown', () => {
    const { socket, client, onError, onRestoreFailed } = setup('s1');
    socket.open();
    client.activate('s2');
    socket.receive({ type: 'error', code: 'not_found', message: 'x' });
    expect(onRestoreFailed).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith('not_found');
  });

  it('other errors go to onError', () => {
    const { socket, onError } = setup(null);
    socket.open();
    socket.receive({ type: 'error', code: 'turn_in_progress', message: 'busy' });
    expect(onError).toHaveBeenCalledExactlyOnceWith('turn_in_progress');
  });

  it('dispose stops dispatching', () => {
    const { socket, store, client, onError } = setup('s1');
    socket.open();
    client.dispose();
    socket.receive(agentEvent('s1', 1));
    socket.receive({ type: 'error', code: 'internal', message: 'x' });
    expect(store.get('s1').items).toEqual([]);
    expect(onError).not.toHaveBeenCalled();
  });

  it('a 5 000-event replay notifies the store listeners once per frame, not once per event', () => {
    let frame: (() => void) | null = null;
    const schedule: Schedule = (callback) => {
      frame = callback;
      return () => {
        frame = null;
      };
    };
    const runFrame = () => {
      const run = frame;
      frame = null;
      run?.();
    };
    const { socket, store } = setup('s1', schedule);
    const listener = vi.fn();
    store.subscribe(listener);
    socket.open();
    // A replay from seq 0: one long answer streamed chunk by chunk; ~100 WS messages arrive per frame.
    const EVENTS = 5000;
    for (let seq = 1; seq <= EVENTS; seq++) {
      socket.receive(agentEvent('s1', seq, 'word '));
      if (seq % 100 === 0) runFrame();
    }
    runFrame();
    // Before the fix every event notified synchronously: 5 000 notifications (= 5 000 React commits).
    expect(listener.mock.calls.length).toBeLessThanOrEqual(50);
    expect(listener.mock.calls.length).toBeGreaterThan(0);
    expect(store.get('s1').lastSeq).toBe(EVENTS);
    expect(store.get('s1').items).toHaveLength(1);
    expect((store.get('s1').items[0] as { text: string }).text).toHaveLength(EVENTS * 5);
  });
});
