import nodemailer from 'nodemailer'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const { drinkName, stock, threshold, recipients, test } = await req.json()

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: false, // TLS über Port 587
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  })

  const toList = String(recipients || '').split(',').map(s => s.trim()).filter(Boolean)
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
    await transporter.sendMail({
      from: `"TSV Getränke" <${process.env.SMTP_USER}>`,
      to: toList,
      subject,
      text,
    })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('Mailversand fehlgeschlagen:', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
