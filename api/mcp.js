// MCP connector (stateless, JSON-RPC over HTTP) that lets Claude create a volunteer
// opportunity and returns a link; opening the link adds it to the page on that device.
const SITE = 'https://volunteer-work-three.vercel.app/';

const TOOL = {
  name: 'create_opportunity',
  description:
    'ينشئ فرصة تطوعية مدرسية ويعيد رابطًا؛ عند فتح الرابط تُضاف الفرصة إلى قائمة "فرصي" في صفحة التطوع على جهاز المستخدم. ' +
    'اكتب كل الحقول بالعربية الفصحى المختصرة، وبنفس أسلوب الفرص الموجودة في الصفحة. ' +
    'يمكن أيضًا تعبئة بيانات التقرير كاملة (المدرسة، التواريخ، عدد المتطوعين، وصف الشواهد، التواقيع، وصور الشواهد برابط مباشر) فتُعبَّأ كل خانات الصفحة عند فتح الرابط.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'اسم الفرصة، مثال: تنظيم مسابقة القراءة' },
      level: { type: 'string', enum: ['عام', 'مهاري'], description: 'مستوى الفرصة' },
      desc: { type: 'string', description: 'وصف الفرصة في جملة أو جملتين' },
      skills: { type: 'array', items: { type: 'string' }, description: 'المهارات المكتسبة (من 2 إلى 5)' },
      tasks: { type: 'array', items: { type: 'string' }, description: 'مهام المتطوع (من 3 إلى 6)' },
      days: { type: 'string', description: 'عدد الأيام، مثال: 3 أيام' },
      hours: { type: 'string', description: 'عدد الساعات في اليوم، مثال: ساعتان' },
      school: { type: 'string', description: 'اسم المدرسة، مثال: ثانوية بدر' },
      report_date: { type: 'string', description: 'تاريخ التقرير بصيغة YYYY-MM-DD' },
      start_date: { type: 'string', description: 'تاريخ بداية الفرصة بصيغة YYYY-MM-DD' },
      end_date: { type: 'string', description: 'تاريخ نهاية الفرصة بصيغة YYYY-MM-DD' },
      volunteers: { type: 'integer', minimum: 0, description: 'عدد المتطوعين' },
      evidence_text: { type: 'string', description: 'وصف مختصر لما تم تنفيذه وأثره (وصف الشواهد)' },
      evidence_images: {
        type: 'array',
        items: { type: 'string' },
        description: 'روابط مباشرة لصور الشواهد (https://… وتنتهي بصورة)؛ حتى 12 صورة'
      },
      sign_principal: { type: 'string', description: 'اسم مدير المدرسة للتوقيع' },
      sign_coordinator: { type: 'string', description: 'اسم منسق التطوع للتوقيع' },
      sign_vice: { type: 'string', description: 'اسم وكيل الشؤون الطلابية للتوقيع' }
    },
    required: ['name', 'desc', 'tasks']
  }
};

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const list = (v, n, max) => (Array.isArray(v) ? v.map(x => str(x, max)).filter(Boolean).slice(0, n) : []);

const date = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : '');
const imageUrls = v => (Array.isArray(v) ? v : [])
  .map(x => str(x, 2000))
  .filter(x => /^https:\/\/[^\s"'<>]+$/i.test(x))
  .slice(0, 12);

function buildLink(a) {
  const opp = {
    name: str(a.name, 120),
    level: a.level === 'مهاري' ? 'مهاري' : 'عام',
    desc: str(a.desc, 600),
    skills: list(a.skills, 8, 60),
    tasks: list(a.tasks, 10, 200),
    days: str(a.days, 40),
    hours: str(a.hours, 40)
  };
  if (!opp.name) throw new Error('اسم الفرصة مطلوب');

  const report = {
    school: str(a.school, 120),
    reportDate: date(a.report_date),
    startDate: date(a.start_date),
    endDate: date(a.end_date),
    volunteers: Number.isFinite(a.volunteers) && a.volunteers >= 0 ? Math.floor(a.volunteers) : '',
    evidenceText: str(a.evidence_text, 1000),
    images: imageUrls(a.evidence_images),
    signPrincipal: str(a.sign_principal, 80),
    signCoordinator: str(a.sign_coordinator, 80),
    signVice: str(a.sign_vice, 80)
  };
  Object.keys(report).forEach(k => {
    if (report[k] === '' || (Array.isArray(report[k]) && !report[k].length)) delete report[k];
  });
  if (Object.keys(report).length) opp.report = report;

  const data = Buffer.from(JSON.stringify(opp), 'utf8').toString('base64url');
  return { opp, url: SITE + '?add=' + data };
}

function handle(msg) {
  const { id, method, params } = msg;
  const ok = result => ({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

  switch (method) {
    case 'initialize':
      return ok({
        protocolVersion: (params && params.protocolVersion) || '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'volunteer-opportunities', version: '1.0.0' }
      });
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: [TOOL] });
    case 'tools/call': {
      if (!params || params.name !== TOOL.name) return fail(-32602, 'أداة غير معروفة');
      try {
        const { opp, url } = buildLink(params.arguments || {});
        return ok({
          content: [{
            type: 'text',
            text: `تم تجهيز الفرصة «${opp.name}». افتح هذا الرابط على جهازك لإضافتها إلى صفحة التطوع:\n${url}`
          }]
        });
      } catch (e) {
        return ok({ isError: true, content: [{ type: 'text', text: e.message }] });
      }
    }
    default:
      return id === undefined ? null : fail(-32601, 'Method not found');
  }
}

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, mcp-protocol-version, mcp-session-id, authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).setHeader('Allow', 'POST').end();

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body) return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });

  const msgs = Array.isArray(body) ? body : [body];
  const out = msgs.map(handle).filter(Boolean);
  if (!out.length) return res.status(202).end();
  res.status(200).json(Array.isArray(body) ? out : out[0]);
};
