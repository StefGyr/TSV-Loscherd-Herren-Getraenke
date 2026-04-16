import { NextRequest, NextResponse } from 'next/server';
import pdf from 'pdf-parse';

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const file = formData.get('file') as File;
        if (!file) {
            return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const data = await pdf(buffer);
        const text = data.text;

        const matches = parseSpielplan(text);

        return NextResponse.json({ matches });
    } catch (error: any) {
        console.error('PDF Parse Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

function parseSpielplan(text: string) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const matches: any[] = [];
    let currentSection = '';

    const sectionHeaders = [
        'Herren Ü32', 'Herren', 'Herren-Reserve',
        'A-Junioren', 'B-Junioren', 'C-Junioren',
        'D-Junioren', 'E-Junioren', 'Frauen',
        'C-Juniorinnen', 'E-Juniorinnen'
    ];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (sectionHeaders.includes(line)) {
            currentSection = line;
            continue;
        }

        const dateRegex = /(\d{2}\.\d{2}\.\d{4})/;
        const dateMatch = line.match(dateRegex);

        if (dateMatch && !line.includes('ZEITRAUM') && !line.includes('Stand:')) {
            const date = dateMatch[1];
            const dateIdx = dateMatch.index!;

            const competition = line.substring(0, dateIdx).trim();
            const rest = line.substring(dateIdx + date.length).trim();

            let time = '';
            let partie = '';

            if (rest.startsWith('SPIELFREI')) {
                time = 'SPIELFREI';
                partie = rest.substring('SPIELFREI'.length).trim();
            } else {
                // Time is usually HH:MM (5 chars)
                const timeMatch = rest.match(/^(\d{2}:\d{2})/);
                if (timeMatch) {
                    time = timeMatch[1];
                    partie = rest.substring(time.length).trim();
                } else {
                    // Fallback if time format is slightly off but row is a match
                    partie = rest;
                }
            }

            let team_home = '';
            let team_guest = '';
            if (partie.includes('-')) {
                const parts = partie.split('-');
                team_home = parts[0].trim();
                team_guest = parts.slice(1).join('-').trim();
            } else {
                team_home = partie;
            }

            // Cleanup multi-line artefacts if any (rare in single-row but possible)
            if (team_home.endsWith('SPIELFREI')) team_home = team_home.replace('SPIELFREI', '').trim();

            let field = '';
            let location = '';

            for (let j = 1; j <= 5; j++) {
                if (i + j < lines.length) {
                    const nextLine = lines[i + j];
                    if (nextLine.includes('Sportanlage') || nextLine.includes('Platz')) {
                        location = nextLine;
                        const fieldMatch = nextLine.match(/Platz\s*(\d+)/i);
                        if (fieldMatch) {
                            field = fieldMatch[1];
                        }
                        break;
                    }
                    // If we hit another match row or section header, stop looking
                    if (dateRegex.test(nextLine) || sectionHeaders.includes(nextLine)) break;
                }
            }

            // Final filters
            if (team_home || team_guest) {
                matches.push({
                    section: currentSection,
                    competition,
                    date: date.split('.').reverse().join('-'),
                    time,
                    team_home,
                    team_guest,
                    location,
                    field
                });
            }
        }
    }
    return matches;
}
