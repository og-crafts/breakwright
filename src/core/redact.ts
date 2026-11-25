/** Hides secret-looking text before anything leaves the machine or reaches an assistant. */
const NAME = String.raw`(?:[\w-]*(?:pass(?:word|wd|code|phrase)?|pwd|secret|token|api[-_]?key|access[-_]?key|private[-_]?key|credentials?|session(?:id)?|otp|cookie|authorization)[\w-]*|auth)`
const PATTERNS: [RegExp, string][] = [
  [/(-----BEGIN [A-Z ]*PRIVATE KEY-----)[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '$1<hidden>'],
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]*/g, '<hidden token>'],
  [/\b(?:sk|pk|rk|ghp|gho|ghs|ghu|github_pat|glpat|xox[abpr])[-_][A-Za-z0-9_-]{12,}|\b(?:AKIA|ASIA)[A-Z0-9]{12,}|\bAIza[\w-]{20,}/g, '<hidden key>'],
  [/\b(Bearer|Basic)\s+[\w.~+/=-]{6,}/gi, '$1 <hidden>'],
  [/(\b\w+:\/\/[^\s/:@'"`]+:)[^\s@'"`]+(@)/g, '$1<hidden>$2'],
  [/(^|\n)((?:set-)?cookie\s*:\s*)[^\n]+/gi, '$1$2<hidden>'],
  [new RegExp(`([?&#]${NAME}=)[^&\\s"'\`]+`, 'gi'), '$1<hidden>'],
  [/([?&#](?:code|key|sig|signature)=)[^&\s"'`]+/gi, '$1<hidden>'],
  // name: "value", 'name': 'value', name = `value`: the closing quote is the one that opened it
  [new RegExp(`((["'\`]?)\\b${NAME}\\2\\s*[:=]\\s*)(["'\`])((?:\\\\.|(?!\\3)[^\\\\\\n]){1,})\\3`, 'gi'), '$1$3<hidden>$3'],
  // NAME=value and name: value without quotes, but not code such as token: getToken() or Password: string
  [new RegExp(`(^|[\\n\\s;,{])(${NAME}\\s*[=:]\\s*)(?![=>"'\`<{[(]|(?:string|number|boolean|await|process|null|undefined|true|false|page|async)\\b)([^\\s"'\`,;(){}]{3,})(?![\\w.]*\\()`, 'gi'), '$1$2<hidden>'],
  // typing into something that looks secret: page.getByLabel('Password').fill('x'), page.fill('#password', 'x')
  [new RegExp(`((?:getBy\\w+|locator)\\([^\\n]*?(?:pass|pwd|secret|token|otp|pin\\b)[^\\n]*?\\.(?:fill|type|pressSequentially)\\(\\s*)(["'\`])((?:\\\\.|(?!\\2)[^\\\\])*)\\2`, 'gi'), '$1$2<hidden>$2'],
  [new RegExp(`(\\.(?:fill|type)\\(\\s*(["'\`])[^\\n]*?(?:pass|pwd|secret|token|otp)[^\\n]*?\\2\\s*,\\s*)(["'\`])((?:\\\\.|(?!\\3)[^\\\\])*)\\3`, 'gi'), '$1$3<hidden>$3'],
]
export class Redactor {
  private values: string[]
  constructor(values: (string | undefined)[] = []) {
    const forms = (v: string) => [v, encodeURIComponent(v), Buffer.from(v).toString('base64'), JSON.stringify(v).slice(1, -1)]
    this.values = [...new Set(values.filter((v): v is string => !!v && v.length >= 4).flatMap(forms))].sort((a, b) => b.length - a.length)
  }
  text(s: string) { for (const v of this.values) s = s.split(v).join('<hidden>'); for (const [re, to] of PATTERNS) s = s.replace(re, to); return s }
}
/** Secret values of the environment, by name. */
export const envSecrets = (env = process.env) => Object.entries(env).filter(([k, v]) => /PASS|PWD$|_PW$|SECRET|TOKEN|KEY|PRIVATE|CREDENTIAL|COOKIE|AUTH|_PAT$|DATABASE_URL|_DSN$|CONNECTION_STRING/i.test(k) && !/^(OLD)?PWD$|SOCK|XAUTHORITY|PATH$/i.test(k) && (v?.length ?? 0) >= 6).map(([, v]) => v)
