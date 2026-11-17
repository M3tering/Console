import { ChildProcess } from 'child_process';
import { promises as fs } from 'fs';
import { BrowserEngine } from '../../src/browser/engine';
import { browserProcessLifetime } from '../../src/browser/lifecycle';

describe('Browser session cleanup',()=>{
  afterEach(()=>{jest.restoreAllMocks();jest.useRealTimers();});

  test('waits for close, not just exit, and repeated stops share one termination',async()=>{
    const child=new ChildProcess();
    const kill=jest.spyOn(child,'kill').mockReturnValue(true);
    const stop=browserProcessLifetime(child);
    const pending=stop();let done=false;void pending.then(()=>{done=true;});
    expect(stop()).toBe(pending);
    child.exitCode=0;child.emit('exit',0,null);
    await Promise.resolve();expect(done).toBe(false);
    child.emit('close',0,null);await pending;
    expect(done).toBe(true);expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith('SIGTERM');
  });

  test('escalates a stuck child and clears the termination timer on close',async()=>{
    jest.useFakeTimers();
    const child=new ChildProcess();const kill=jest.spyOn(child,'kill').mockReturnValue(true);
    const pending=browserProcessLifetime(child)();
    jest.advanceTimersByTime(2000);expect(kill.mock.calls).toEqual([['SIGTERM'],['SIGKILL']]);
    child.emit('close',null,'SIGKILL');await pending;expect(jest.getTimerCount()).toBe(0);
  });

  test('a child that closed before disposal needs neither another signal nor a wait',async()=>{
    const child=new ChildProcess();const kill=jest.spyOn(child,'kill').mockReturnValue(true);
    const stop=browserProcessLifetime(child);child.emit('close',1,null);
    await stop();expect(kill).not.toHaveBeenCalled();
  });

  test('close during startup waits for writers and child shutdown; cleanup errors never escape',async()=>{
    let started!:()=>void,stopped!:()=>void;
    const starting=new Promise<void>(resolve=>{started=resolve;});
    const stopping=new Promise<void>(resolve=>{stopped=resolve;});
    const stop=jest.fn(()=>stopping),emit=jest.fn();
    const engine=new BrowserEngine({role:'standalone',executable:'/unused-test-browser',emit});
    engine['starting']=starting;engine['directory']='/test-profile';engine['stopProcess']=stop;
    const rm=jest.spyOn(fs,'rm').mockRejectedValue(Object.assign(new Error('private-path'),{code:'ENOTEMPTY'}));
    const warn=jest.spyOn(console,'warn').mockImplementation(()=>{});
    engine.close();engine.close();
    await Promise.resolve();expect(stop).not.toHaveBeenCalled();expect(rm).not.toHaveBeenCalled();
    started();await starting;await Promise.resolve();await Promise.resolve();
    expect(stop).toHaveBeenCalledTimes(1);expect(rm).not.toHaveBeenCalled();
    stopped();await new Promise<void>(resolve=>setImmediate(resolve));
    expect(rm).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('Browser session cleanup failed; temporary profile could not be removed.');
    expect(emit).toHaveBeenCalledTimes(1);expect(emit).toHaveBeenCalledWith({type:'closed'});
  });
});
