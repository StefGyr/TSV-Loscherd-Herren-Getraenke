import { NextResponse } from 'next/server'

// Beispiel mit Resend (https://resend.com) – ENV: RESEND_API_KEY
// Alternativ geht jeder SMTP-Provider via nodemailer.
export async function POST(req: Request) {
  const { drinkName, stock, threshold, recipients } = await req.json()
  const toList = String(recipients || '').split(',').map((s)=>s.trim()).filter(Boolean)
  if (toList.length === 0) return NextResponse.json({ ok: false, error: 'no recipients' }, { status: 400 })

  const subject = `⚠️ Niedriger Bestand: ${drinkName} (Bestand ${stock} < Schwelle ${threshold})`
  const text = [
    `Hallo,`,
    ``,
    `für "${drinkName}" wurde ein niedriger Bestand erkannt.`,
    `Aktueller Bestand: ${stock} Flaschen`,
    `Warnschwelle: ${threshold} Flaschen`,
    ``,
    `Zeit: ${new Date().toLocaleString('de-DE')}`,
    ``,
    `— TSV Getränke-System`
  ].join('\n')

  try {
    // Resend
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'TSV Getränke <no-reply@tsv-lonnerstadt.de>',
        to: toList,
        subject,
        text,
      })
    })
    if (!resp.ok) {
      const err = await resp.text()
      return NextResponse.json({ ok:false, error: err }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (e:any) {
    return NextResponse.json({ ok:false, error: String(e) }, { status: 500 })
  }
}
