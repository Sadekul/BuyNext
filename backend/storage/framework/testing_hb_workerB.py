import json, os, sys
BN='/var/www/buynest/backend/lang/bn.json'
os.chdir('/var/www/buynest/backend')
_files={}
def R(path, old, new, count=1):
    s=_files.get(path) or open(path).read()
    n=s.count(old)
    if n!=count:
        print(f"!! {path}: expected {count} got {n}: {old[:90]}"); return
    _files[path]=s.replace(old,new)
def W(path, *pairs):
    for lit in pairs:
        s=_files.get(path) or open(path).read()
        c=s.count(lit); w=s.count("__("+lit)
        if w: print("already wrapped", lit[:60]); continue
        R(path, lit, f"__({lit})", c if c else 1)
def T(d):
    cur=json.load(open(BN))
    for k,v in d.items():
        if k in cur and cur[k]!=v: print("~~ overwrite", k)
        cur[k]=v
    with open(BN,'w') as f:
        json.dump(dict(sorted(cur.items())), f, ensure_ascii=False, indent=4); f.write('\n')
def save():
    for p,s in _files.items(): open(p,'w').write(s)
    print("saved", len(_files))
