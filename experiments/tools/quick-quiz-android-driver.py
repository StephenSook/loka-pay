#!/usr/bin/env python3
"""Drive the ordinary Quick Quiz UI on an explicitly selected physical Android.
No engine or network substitution. UI timing includes automation overhead.
"""
import argparse, json, re, subprocess, time
from pathlib import Path
from xml.etree import ElementTree as ET
p=argparse.ArgumentParser()
p.add_argument('--serial',required=True); p.add_argument('--adb',default='adb')
p.add_argument('--output',required=True); p.add_argument('--invite',default=None)
a=p.parse_args(); out=Path(a.output); out.mkdir(parents=True,exist_ok=True)
records=[]
def adb(*args): return subprocess.check_output([a.adb,'-s',a.serial,*args])
def record(event,**values):
    entry={'timeMs':int(time.time()*1000),'event':event,**values};records.append(entry)
    (out/'android-ui-events.json').write_text(json.dumps(records,indent=2)+'\n')
    print(json.dumps(entry),flush=True)
def tree():
    adb('shell','uiautomator','dump','/sdcard/loka-quiz-driver.xml')
    return ET.fromstring(adb('exec-out','cat','/sdcard/loka-quiz-driver.xml'))
def bounds(node): return list(map(int,re.findall(r'\d+',node.get('bounds',''))))
def node(root,label): return next((n for n in root.iter('node') if n.get('text')==label or n.get('content-desc')==label),None)
def tap(root,label):
    n=node(root,label)
    if n is None: return False
    parents={c:p for p in root.iter() for c in p}
    while n.get('clickable')!='true' and n in parents:n=parents[n]
    b=bounds(n)
    if len(b)!=4 or b[3]<=b[1] or n.get('enabled')!='true':return False
    adb('shell','input','tap',str((b[0]+b[2])//2),str((b[1]+b[3])//2));return True
size=list(map(int,re.findall(rb'\d+',adb('shell','wm','size'))[-2:])); w,h=size
answers=['Mars','Three','Pacific','Au','60','Dolphin','56','Piano','Octagon','0']
root=tree()
if node(root,'Play') is not None and node(root,'Quick Quiz') is None:tap(root,'Play');root=tree()
if a.invite:
    for _ in range(8):
        if tap(root,'Invite '+a.invite):record('invitation-tapped');break
        adb('shell','input','swipe',str(w//2),str(int(h*.78)),str(w//2),str(int(h*.35)),'400');root=tree()
    else:raise SystemExit('Invitation button unavailable; no trust bypass attempted')
record('host-driver-started')
deadline=time.monotonic()+240; answered=set()
while time.monotonic()<deadline:
    root=tree(); texts=[n.get('text','') for n in root.iter('node')]
    if 'Quiz complete!' in texts:
        score=next((s for s in texts if s.startswith('You ') and '  •  ' in s),'')
        record('complete',score=score)
        (out/'android-complete.png').write_bytes(adb('exec-out','screencap','-p'))
        assert score.startswith('You 5  •  ') and score.endswith(' 5'),score
        break
    question=next((re.fullmatch(r'Question (\d+) of 10',s) for s in texts if re.fullmatch(r'Question (\d+) of 10',s)),None)
    if question:
        rev=int(question.group(1))-1
        if rev%2==0 and rev not in answered and tap(root,answers[rev]):
            answered.add(rev);record('host-answer-tapped',revision=rev)
            time.sleep(.5);continue
    if question is None or (question and question.group(1) and node(root,answers[int(question.group(1))-1]) is None):
        adb('shell','input','swipe',str(w//2),str(int(h*.78)),str(w//2),str(int(h*.35)),'400')
    time.sleep(1)
else:
    record('timeout',answersTapped=sorted(answered))
    (out/'android-timeout.png').write_bytes(adb('exec-out','screencap','-p'))
    raise SystemExit('Physical UI game timed out; inspect devices and route evidence')
