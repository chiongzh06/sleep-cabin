# 生成部署版 public/index.html（debug=1 时附加测试钩子）
import json,base64,sys
tpl='/home/claude/build/template5.html';debug=len(sys.argv)>1 and sys.argv[1]=='debug'
s=open(tpl,encoding='utf-8').read()
s=s.replace('<script type=module>','<script>window.ROOM_WS=(location.protocol==="https:"?"wss://":"ws://")+location.host+"/ws";</script>\n<script type=module>',1)
if debug:
    hook="\nwindow.__dbg={noAuto:()=>{manualQ=true},setPos:(x,z)=>{me.g.position.set(x,0,z);me.tx=x;me.tz=z;me.path=[];pub()},setCam:(y,p,d)=>{yaw=y;pitch=p;dist=d},lie:i=>tx({t:'lie',bed:i}),wake:()=>tx({t:'wake'}),get me(){return me},av,R};\n"
    i=s.rindex("</script>",s.index("<script type=module>"));s=s[:i]+hook+s[i:]
data=json.load(open('/home/claude/build/data.json'))
for k,p in [('mtn','/home/claude/scene/mtn360.webp'),('forest','/home/claude/scene/forest360.webp')]:
    data[k]='data:image/webp;base64,'+base64.b64encode(open(p,'rb').read()).decode()
bundle=open('/home/claude/build/bundle.js',encoding='utf-8').read()
out=s.replace('/*BUNDLE*/','<script>'+bundle+'</script>\n<script>window.DATA='+json.dumps(data)+';</script>')
open('/home/claude/deploy/public/index.html','w',encoding='utf-8').write(out)
print('built',('debug' if debug else 'release'),round(len(out.encode())/1e6,2),'MB')
