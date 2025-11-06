import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const { drinkName, stock, threshold, recipients, test } = await req.json()

  // Empfänger-Liste normalisieren
  const toList = String(recipients || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

  const subject = test
    ? `✅ Test-Mail: Low-Stock-Benachrichtigung für ${drinkName}`
    : `⚠️ Niedriger Bestand: ${drinkName} (${stock} < ${threshold})`

  const text = [
    test ? 'Dies ist eine Test-Mail.' : 'Es wurde ein niedriger Bestand erkannt!',
    '',
    `Getränk: ${drinkName}`,
    `Bestand: ${stock} Flaschen`,
    `Warnschwelle: ${threshold} Flaschen`,
    '',
    `Zeit: ${new Date().toLocaleString('de-DE')}`,
    '',
    '— TSV Getränke-System',
  ].join('\n')

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // Mit dieser Absenderadresse funktioniert es sofort – keine Domain-Verifizierung nötig:
        from: 'TSV Getränke <onboarding@resend.dev>',
        to: toList,
        subject,
        text,
      }),
    })

    const data = await res.json()
    if (!res.ok) {
      console.error('Resend error:', data)
      return NextResponse.json({ ok: false, error: data }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('Mailversand fehlgeschlagen:', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
