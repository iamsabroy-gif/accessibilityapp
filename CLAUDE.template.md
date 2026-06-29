# <project-name>
STACK:<lang+version>+<framework>|<runtime>|<auth?>|<limits?>

FILES
<entrypoint>(entry)
<pkg>/<file>(purpose)|<file>(purpose)

API(–=open JWT=auth)
<METHOD> <path>(auth)

TYPES
TypeName{field,field?,field[]}

SCORING
<formula>|grades:<A≥n B≥n …>

ENV
VAR(req)|VAR(opt,def:<val>)

ARCH
<invariant agents must not break>

CMD:build=…|test=…|start=…|lint=…

AGENTS:@role(scope,rw|ro)|@role(scope)
