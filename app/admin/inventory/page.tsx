'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase-browser'
import TopNav from '@/components/TopNav'
import AdminNav from '@/components/AdminNav'
import { AnimatePresence, motion } from 'framer-motion'

type Drink = { id:number; name:string; price_cents:number; ek_crate_price_cents:number|null }
type Consumption = {
  id:number; user_id:string|null; drink_id:number|null; quantity:number; unit_price_cents:number|null;
  source:'single'|'crate'|string|null; via_terminal?:boolean|null; created_at:string;
  profiles?:{ first_name:string|null; last_name:string|null } | { first_name:string|null; last_name:string|null }[];
  drinks?:{ name:string } | { name:string }[];
}
type Purchase = { id:number; drink_id:number; quantity:number; crate_price_cents:number; created_at:string }
type Payment = {
  id:number; user_id:string; amount_cents:number; method:'bar'|'paypal'|string; verified:boolean; created_at:string;
  profiles?:{ first_name:string|null; last_name:string|null } | { first_name:string|null; last_name:string|null }[];
}
type Profile = { id:string; open_balance_cents:number|null }
type Threshold = { id:number; drink_id:number; threshold_bottles:number; notify_email:string|null }

const BOTTLES_PER_CRATE = 20
const euro = (c:number)=> (c/100).toFixed(2) + ' €'
const startOfToday = ()=>{const d=new Date(); d.setHours(0,0,0,0); return d}
const startOfWeek = ()=>{const d=startOfToday(); const day=d.getDay()||7; d.setDate(d.getDate()-(day-1)); return d}
const startOfMonth = ()=>{const d=startOfToday(); d.setDate(1); return d}

export default function InventoryRevenuePage() {
  // ===== state =====
  const [drinks,setDrinks]=useState<Drink[]>([])
  const [consumptions,setConsumptions]=useState<Consumption[]>([])
  const [purchases,setPurchases]=useState<Purchase[]>([])
  const [payments,setPayments]=useState<Payment[]>([])
  const [profiles,setProfiles]=useState<Profile[]>([])
  const [thresholds,setThresholds]=useState<Threshold[]>([])
  const [loading,setLoading]=useState(true)
  const [toasts,setToasts]=useState<{id:number;text:string;type?:'success'|'error'}[]>([])

  const addToast=(text:string,type:'success'|'error'='success')=>{
    const id=Date.now(); setToasts(p=>[...p,{id,text,type}]); setTimeout(()=>setToasts(p=>p.filter(t=>t.id!==id)),3200)
  }

  // ===== filter =====
  const [rangePreset,setRangePreset]=useState<'today'|'week'|'month'|'custom'>('month')
  const [from,setFrom]=useState(()=>startOfMonth().toISOString().slice(0,10))
  const [to,setTo]=useState(()=>new Date().toISOString().slice(0,10))
  useEffect(()=>{
    if(rangePreset==='custom') return
    if(rangePreset==='today'){ setFrom(startOfToday().toISOString().slice(0,10)); setTo(new Date().toISOString().slice(0,10)) }
    else if(rangePreset==='week'){ setFrom(startOfWeek().toISOString().slice(0,10)); setTo(new Date().toISOString().slice(0,10)) }
    else if(rangePreset==='month'){ setFrom(startOfMonth().toISOString().slice(0,10)); setTo(new Date().toISOString().slice(0,10)) }
  },[rangePreset])

  // ===== load =====
  useEffect(()=>{
    const load=async()=>{
      setLoading(true)
      const [
        {data:drinksData},
        {data:consData},
        {data:purchData},
        {data:payData},
        {data:profData},
        {data:thrData},
      ] = await Promise.all([
        supabase.from('drinks').select('id,name,price_cents,ek_crate_price_cents'),
        supabase.from('consumptions').select(`
          id,user_id,drink_id,quantity,unit_price_cents,source,via_terminal,created_at,
          profiles!consumptions_user_id_fkey(first_name,last_name),
          drinks!consumptions_drink_id_fkey(name)
        `).order('created_at',{ascending:true}),
        supabase.from('purchases').select('id,drink_id,quantity,crate_price_cents,created_at').order('created_at',{ascending:true}),
        supabase.from('payments').select('id,user_id,amount_cents,method,verified,created_at,profiles(first_name,last_name)').eq('verified',true).order('created_at',{ascending:true}),
        supabase.from('profiles').select('id,open_balance_cents'),
        supabase.from('inventory_thresholds').select('id,drink_id,threshold_bottles,notify_email'),
      ])
      setDrinks(drinksData||[])
      setConsumptions((consData as any[])||[])
      setPurchases(purchData||[])
      setPayments(payData||[])
      setProfiles(profData||[])
      setThresholds(thrData||[])
      setLoading(false)
    }
    load()
  },[])

  // ===== helpers =====
  const inRange=(iso:string)=>{const d=new Date(iso); const f=new Date(from+'T00:00:00'); const t=new Date(to+'T23:59:59'); return d>=f && d<=t}
  const consInRange=useMemo(()=>consumptions.filter(c=>inRange(c.created_at)),[consumptions,from,to])
  const purchInRange=useMemo(()=>purchases.filter(p=>inRange(p.created_at)),[purchases,from,to])
  const paymentsInRange=useMemo(()=>payments.filter(p=>inRange(p.created_at)),[payments,from,to])

  // ===== KPIs =====
  const totalPaymentsCents = useMemo(()=>paymentsInRange.reduce((s,p)=>s+(p.amount_cents||0),0),[paymentsInRange])

  // exakt wie Profil-Logik: App-Kisten = source='crate' && !via_terminal; Summe = unit_price_cents
  const freeBeerAppCents = useMemo(
    ()=>consInRange.filter(c=>c.source==='crate' && !c.via_terminal)
                   .reduce((s,c)=>s+(c.unit_price_cents||0),0),
    [consInRange]
  )

  // Einkaufskosten = Preis pro Kiste × Anzahl Kisten
const costCents = useMemo(
  () => purchInRange.reduce((s, p) => s + (p.crate_price_cents || 0) * (p.quantity || 0), 0),
  [purchInRange]
)

  const profitCents = useMemo(()=>totalPaymentsCents - costCents,[totalPaymentsCents,costCents])
  const openPostenCents = useMemo(()=>profiles.reduce((s,p)=>s+(p.open_balance_cents||0),0),[profiles])

  // ===== inventory (bottles) =====
  const inventory = useMemo(()=>{
    const bought = new Map<number,number>()
    purchases.forEach(p=>{
      const bottles=(p.quantity||0)*BOTTLES_PER_CRATE
      bought.set(p.drink_id,(bought.get(p.drink_id)||0)+bottles)
    })
    const sold = new Map<number,number>()
    consumptions.forEach(c=>{ if(!c.drink_id) return; sold.set(c.drink_id,(sold.get(c.drink_id)||0)+(c.quantity||0)) })
    return drinks.map(d=>{
      const b=bought.get(d.id)||0, s=sold.get(d.id)||0
      const ekBottle = d.ek_crate_price_cents!=null ? d.ek_crate_price_cents/100/BOTTLES_PER_CRATE : null
      return { id:d.id, name:d.name, stock:b-s, sold:s, ekBottle, vkBottle:d.price_cents/100 }
    })
  },[drinks,purchases,consumptions])

  // ===== thresholds map =====
  const thresholdByDrink = useMemo(()=>{
    const m=new Map<number,Threshold>()
    thresholds.forEach(t=>m.set(t.drink_id,t))
    return m
  },[thresholds])

  // ===== Auto Low-Stock mail (on render/inventory change) =====
  useEffect(()=>{
    const notify = async ()=>{
      const below = inventory.filter(row=>{
        const th = thresholdByDrink.get(row.id)?.threshold_bottles ?? 0
        return th>0 && row.stock < th
      })
      if(below.length===0) return

      // Entdoppeln via low_stock_events (einmal pro Tag/Drink)
      const today = new Date().toISOString().slice(0,10)
      for (const row of below) {
        const th = thresholdByDrink.get(row.id)
        const emails = (th?.notify_email && th.notify_email.trim().length>0)
          ? th.notify_email
          : 'bennybecool@gmx.de,geyer1992@hotmail.de' // Default wie gewünscht

        // check: schon gemeldet?
        const { data:already } = await supabase
          .from('low_stock_events')
          .select('id')
          .eq('drink_id', row.id)
          .eq('event_date', today)
          .limit(1)

        if (already && already.length>0) continue

        // anlegen event (damit pro Tag nur einmal pro Drink)
        await supabase.from('low_stock_events').insert({
          drink_id: row.id, event_date: today, stock_bottles: row.stock
        })

        // Mail feuern (Next.js API-Route)
        await fetch('/api/notify-low-stock', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({
            drinkName: row.name,
            stock: row.stock,
            threshold: th?.threshold_bottles ?? 0,
            recipients: emails
          })
        })
      }
    }
    notify().catch(()=>{})
  },[inventory,thresholdByDrink])

  // ===== Actions: purchase & adjust & EK & save thresholds =====
  const [purchaseForm,setPurchaseForm]=useState({drink_id:'',bottles:'',total_price_eur:''})
  const saveBottlePurchase=async()=>{
    const drink_id=Number(purchaseForm.drink_id)
    const bottles=Number(purchaseForm.bottles)
    const totalPriceCents=Math.round(Number(purchaseForm.total_price_eur)*100)
    if(!drink_id||!bottles||!totalPriceCents){ addToast('Bitte Getränk, Flaschenanzahl und Gesamt-EK angeben','error'); return }
    const crateQty=bottles/BOTTLES_PER_CRATE
    const {error}=await supabase.from('purchases').insert({ drink_id, quantity: crateQty, crate_price_cents: totalPriceCents })
    if(error){ addToast('Speichern fehlgeschlagen (prüfe Datentyp von purchases.quantity)','error'); return }
    addToast('Einkauf (Flaschen) gespeichert'); setPurchaseForm({drink_id:'',bottles:'',total_price_eur:''})
    const {data}=await supabase.from('purchases').select('id,drink_id,quantity,crate_price_cents,created_at'); setPurchases(data||[])
  }

  const [adjustForm,setAdjustForm]=useState({drink_id:'',delta_bottles:'',note:''})
  const applyStockAdjustment=async()=>{
    const drink_id=Number(adjustForm.drink_id)
    const delta=Number(adjustForm.delta_bottles)
    if(!drink_id||!delta){ addToast('Bitte Getränk und Delta (± Flaschen) angeben','error'); return }
    const crateQty=delta/BOTTLES_PER_CRATE
    const {error}=await supabase.from('purchases').insert({ drink_id, quantity: crateQty, crate_price_cents: 0 })
    if(error){ addToast('Bestandskorrektur fehlgeschlagen','error'); return }
    addToast('Bestand angepasst'); setAdjustForm({drink_id:'',delta_bottles:'',note:''})
    const {data}=await supabase.from('purchases').select('id,drink_id,quantity,crate_price_cents,created_at'); setPurchases(data||[])
  }

  const updateEKCrate=async(drinkId:number, eur:number)=>{
    if(!eur||eur<=0) return
    const {error}=await supabase.from('drinks').update({ ek_crate_price_cents: Math.round(eur*100) }).eq('id',drinkId)
    if(error) addToast('EK/Kiste Speichern fehlgeschlagen','error'); else addToast('EK/Kiste aktualisiert')
  }

  // save threshold/email
  const saveThreshold = async (drink_id:number, threshold_bottles:number, notify_email:string)=>{
    const existing = thresholds.find(t=>t.drink_id===drink_id)
    let q
    if(existing) q = supabase.from('inventory_thresholds').update({ threshold_bottles, notify_email }).eq('drink_id',drink_id)
    else q = supabase.from('inventory_thresholds').insert({ drink_id, threshold_bottles, notify_email })
    const { error } = await q
    if(error){ addToast('Schwellwert speichern fehlgeschlagen','error') }
    else{
      addToast('Schwellwert gespeichert')
      const { data } = await supabase.from('inventory_thresholds').select('id,drink_id,threshold_bottles,notify_email')
      setThresholds(data||[])
    }
  }

  // ===== CSV Export (alle relevanten Tabellen) =====
  const exportAllAsCSV = async ()=>{
    addToast('Erstelle CSV…')
    const [dr,co,pu,pa,pr] = await Promise.all([
      supabase.from('drinks').select('*'),
      supabase.from('consumptions').select('*,drinks(name),profiles(first_name,last_name)'),
      supabase.from('purchases').select('*'),
      supabase.from('payments').select('*,profiles(first_name,last_name)'),
      supabase.from('profiles').select('*'),
    ])
    const rows: string[] = []
    const pushSection = (title:string, headers:string[], data:any[], mapRow:(x:any)=>any[])=>{
      rows.push(`# ${title}`); rows.push(headers.join(';'))
      for (const x of (data || [])) rows.push(mapRow(x).map(v => String(v ?? '')).join(';'))
      rows.push('') // blank line
    }

    pushSection('DRINKS',['id','name','price_eur','ek_crate_eur'],
      dr.data||[], (x)=>[x.id,x.name,(x.price_cents/100).toFixed(2), x.ek_crate_price_cents!=null?(x.ek_crate_price_cents/100).toFixed(2):'' ])

    pushSection('CONSUMPTIONS',['id','created_at','user','drink','quantity','source','via_terminal','unit_price_eur'],
      co.data||[], (x)=>[
        x.id,x.created_at,
        `${x.profiles?.first_name||''} ${x.profiles?.last_name||''}`.trim(),
        x.drinks?.name || '',
        x.quantity, x.source, x.via_terminal? 'true':'false',
        x.unit_price_cents!=null ? (x.unit_price_cents/100).toFixed(2) : ''
      ])

    // ✅ EK-Fix: Gesamtpreis = crate_price_cents × quantity
pushSection(
  'PURCHASES',
  ['id','created_at','drink_id','quantity_kisten','crate_price_eur','gesamtpreis_eur'],
  pu.data || [],
  (x) => [
    x.id,
    x.created_at,
    x.drink_id,
    x.quantity,
    (x.crate_price_cents / 100).toFixed(2), // Preis pro Kiste
    ((x.quantity * x.crate_price_cents) / 100).toFixed(2) // Gesamtpreis
  ]
)


    pushSection('PAYMENTS',['id','created_at','user','method','amount_eur','verified'],
      pa.data||[], (x)=>[
        x.id,x.created_at,
        `${x.profiles?.first_name||''} ${x.profiles?.last_name||''}`.trim(),
        x.method,(x.amount_cents/100).toFixed(2), x.verified? 'true':'false'
      ])

    pushSection('PROFILES',['id','first_name','last_name','open_balance_eur'],
      pr.data||[], (x)=>[x.id,x.first_name||'',x.last_name||'', ((x.open_balance_cents||0)/100).toFixed(2)])

    const blob = new Blob([rows.join('\n')], { type:'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tsv_getraenke_export_${new Date().toISOString().slice(0,10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    addToast('CSV exportiert')
  }

  if(loading) return <div className="p-6 text-center text-white">⏳ Lade Daten…</div>

  return (
    <>
      <TopNav />
      <AdminNav />

      <div className="pt-20 max-w-7xl mx-auto p-4 text-white space-y-8">
        {/* Header + Filter + Export */}
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <h1 className="text-2xl font-bold">📦 Bestand & 💶 Einnahmen</h1>
          <div className="flex items-center gap-2">
            <div className="bg-gray-800/70 border border-gray-700 rounded-xl p-3 flex items-center gap-2">
              <select className="bg-gray-900 border border-gray-700 rounded p-2" value={rangePreset} onChange={e=>setRangePreset(e.target.value as any)}>
                <option value="today">Heute</option>
                <option value="week">Diese Woche</option>
                <option value="month">Dieser Monat</option>
                <option value="custom">Benutzerdefiniert</option>
              </select>
              <input type="date" className="bg-gray-900 border border-gray-700 rounded p-2" value={from} onChange={e=>setFrom(e.target.value)} disabled={rangePreset!=='custom'} />
              <span className="text-gray-400 text-sm">bis</span>
              <input type="date" className="bg-gray-900 border border-gray-700 rounded p-2" value={to} onChange={e=>setTo(e.target.value)} disabled={rangePreset!=='custom'} />
            </div>
            <button onClick={exportAllAsCSV} className="bg-teal-700 hover:bg-teal-800 rounded px-3 py-2 text-sm font-medium">
              📤 CSV-Export
            </button>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <Stat title="Gesamteinnahmen (verifiziert)" value={euro(totalPaymentsCents)} />
          <Stat title="Freibier-Einnahmen (App-Kisten)" value={euro(freeBeerAppCents)} />
          <Stat title="Kosten (EK)" value={euro(costCents)} />
          <Stat title="Gewinn" value={euro(profitCents)} />
          <Stat title="Offene Posten" value={euro(openPostenCents)} />
        </div>

        {/* Bestand */}
        <section className="bg-gray-800/70 p-4 rounded border border-gray-700 shadow space-y-4">
          <h2 className="text-lg font-semibold">Getränkebestand (Flaschen)</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="p-2 text-left">Getränk</th>
                  <th className="p-2 text-right">Bestand</th>
                  <th className="p-2 text-right">Verkauft (gesamt)</th>
                  <th className="p-2 text-right">EK/Kiste (€)</th>
                  <th className="p-2 text-right">EK/Flasche (€)</th>
                  <th className="p-2 text-right">VK/Flasche (€)</th>
                  <th className="p-2 text-right">Warnschwelle</th>
                  <th className="p-2 text-left">Warn-E-Mail(s)</th>
                  <th className="p-2 text-right">Aktion</th>
                </tr>
              </thead>
              <tbody>
  {inventory.map((row) => {
    const ekCrate = drinks.find((d) => d.id === row.id)?.ek_crate_price_cents
    const th = thresholdByDrink.get(row.id)
    const low = th && row.stock < th.threshold_bottles
    const currentThreshold = th?.threshold_bottles ?? 20
    const currentEmails = th?.notify_email ?? 'bennybecool@gmx.de,geyer1992@hotmail.de'

    // 🔹 Funktion zum Test-Mail-Versand
    const sendTestMail = async () => {
      try {
        const res = await fetch('/api/notify-low-stock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            drinkName: row.name,
            stock: row.stock,
            threshold: currentThreshold,
            recipients: currentEmails,
            test: true,
          }),
        })
        if (res.ok) {
          addToast(`Test-Mail für ${row.name} gesendet ✅`)
        } else {
          const err = await res.text()
          addToast(`Fehler beim Test-Mail: ${err}`, 'error')
        }
      } catch (err: any) {
        addToast(`Test-Mail fehlgeschlagen: ${String(err)}`, 'error')
      }
    }

    return (
      <tr key={row.id} className={`border-t border-gray-700 ${low ? 'bg-red-950/30' : ''}`}>
        <td className="p-2">{row.name}</td>
        <td className={`p-2 text-right ${low ? 'text-red-400 font-semibold' : ''}`}>{row.stock}</td>
        <td className="p-2 text-right">{row.sold}</td>
        <td className="p-2 text-right">{ekCrate ? (ekCrate / 100).toFixed(2) : ''}</td>
        <td className="p-2 text-right">{row.ekBottle != null ? row.ekBottle.toFixed(2) : ''}</td>
        <td className="p-2 text-right">{row.vkBottle.toFixed(2)}</td>

        {/* 🔹 Schwellwert */}
        <td className="p-2 text-right">
          <input
            type="number"
            defaultValue={currentThreshold}
            onBlur={(e) =>
              saveThreshold(row.id, parseInt(e.target.value || '0'), currentEmails)
            }
            className="bg-gray-900 border border-gray-700 rounded text-right w-20 p-1"
          />
        </td>

        {/* 🔹 E-Mail */}
        <td className="p-2">
          <input
            type="text"
            defaultValue={currentEmails}
            onBlur={(e) =>
              saveThreshold(
                row.id,
                currentThreshold,
                e.target.value.trim()
              )
            }
            className="bg-gray-900 border border-gray-700 rounded w-56 p-1"
          />
        </td>

        {/* 🔹 Aktionen */}
        <td className="p-2 text-right space-x-1">
          <button
            onClick={() =>
              saveThreshold(row.id, currentThreshold, currentEmails)
            }
            className="bg-blue-700 hover:bg-blue-800 rounded px-2 py-1 text-sm"
          >
            💾 Speichern
          </button>

          {/* ✉️ Test-Mail */}
          <button
            onClick={sendTestMail}
            className="bg-teal-700 hover:bg-teal-800 rounded px-2 py-1 text-sm"
          >
            ✉️ Test-Mail
          </button>
        </td>
      </tr>
    )
  })}
</tbody>


            </table>
          </div>
        </section>

        {/* Zugang buchen */}
        <section className="bg-gray-800/70 p-4 rounded border border-gray-700 shadow space-y-3">
          <h2 className="text-lg font-semibold">Zugang buchen (Flaschen)</h2>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <select className="bg-gray-900 border border-gray-700 rounded p-2" value={purchaseForm.drink_id} onChange={e=>setPurchaseForm(p=>({...p,drink_id:e.target.value}))}>
              <option value="">Getränk wählen…</option>
              {drinks.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <input type="number" className="bg-gray-900 border border-gray-700 rounded p-2" placeholder="Anzahl Flaschen" value={purchaseForm.bottles} onChange={e=>setPurchaseForm(p=>({...p,bottles:e.target.value}))}/>
            <input type="number" step="0.01" className="bg-gray-900 border border-gray-700 rounded p-2" placeholder="EK gesamt (€)" value={purchaseForm.total_price_eur} onChange={e=>setPurchaseForm(p=>({...p,total_price_eur:e.target.value}))}/>
            <div className="self-center text-gray-400 text-sm">
              EK/Flasche: {(()=>{
                const b=Number(purchaseForm.bottles), eur=Number(purchaseForm.total_price_eur)
                return (b>0 && eur>0) ? (eur/b).toFixed(2)+' €' : '-'
              })()}
            </div>
            <button onClick={saveBottlePurchase} className="bg-green-700 hover:bg-green-800 rounded p-2 font-medium">Speichern</button>
          </div>
        </section>

        {/* Bestand korrigieren */}
        <section className="bg-gray-800/70 p-4 rounded border border-gray-700 shadow space-y-3">
          <h2 className="text-lg font-semibold">Bestand korrigieren (± Flaschen)</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <select className="bg-gray-900 border border-gray-700 rounded p-2" value={adjustForm.drink_id} onChange={e=>setAdjustForm(p=>({...p,drink_id:e.target.value}))}>
              <option value="">Getränk wählen…</option>
              {drinks.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <input type="number" className="bg-gray-900 border border-gray-700 rounded p-2" placeholder="± Flaschen (z. B. -3)" value={adjustForm.delta_bottles} onChange={e=>setAdjustForm(p=>({...p,delta_bottles:e.target.value}))}/>
            <input type="text" className="bg-gray-900 border border-gray-700 rounded p-2" placeholder="Notiz (Inventur/Bruch/Verlust)…" value={adjustForm.note} onChange={e=>setAdjustForm(p=>({...p,note:e.target.value}))}/>
            <button onClick={applyStockAdjustment} className="bg-blue-700 hover:bg-blue-800 rounded p-2 font-medium">Korrigieren</button>
          </div>
        </section>

        {/* Zahlungen (verifiziert) */}
        <section className="bg-gray-800/70 p-4 rounded border border-gray-700 shadow space-y-3">
          <h2 className="text-lg font-semibold">💳 Verifizierte Zahlungen (Zeitraum)</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="p-2 text-left">Datum</th>
                  <th className="p-2 text-left">Nutzer</th>
                  <th className="p-2 text-left">Methode</th>
                  <th className="p-2 text-right">Betrag</th>
                </tr>
              </thead>
              <tbody>
                {paymentsInRange.length===0 ? (
                  <tr><td colSpan={4} className="p-3 text-gray-400">Keine verifizierten Zahlungen im Zeitraum.</td></tr>
                ) : paymentsInRange.map(p=>{
                  const prof = Array.isArray(p.profiles)? p.profiles[0] : p.profiles
                  const userName = `${prof?.first_name||''} ${prof?.last_name||''}`.trim() || 'Unbekannt'
                  return (
                    <tr key={p.id} className="border-t border-gray-700">
                      <td className="p-2">{new Date(p.created_at).toLocaleString('de-DE')}</td>
                      <td className="p-2">{userName}</td>
                      <td className="p-2">{p.method==='paypal'?'PayPal':'Bar'}</td>
                      <td className="p-2 text-right">{euro(p.amount_cents)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* App-Kisten (Freibier) mit Bereitsteller */}
        <section className="bg-gray-800/70 p-4 rounded border border-gray-700 shadow space-y-3">
          <h2 className="text-lg font-semibold">🎁 Bereitgestellte Kisten (App-Freibier)</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="p-2 text-left">Datum</th>
                  <th className="p-2 text-left">Bereitsteller</th>
                  <th className="p-2 text-left">Getränk</th>
                  <th className="p-2 text-right">Betrag</th>
                </tr>
              </thead>
              <tbody>
                {consInRange.filter(c=>c.source==='crate' && !c.via_terminal).length===0 ? (
                  <tr><td colSpan={4} className="p-3 text-gray-400">Keine bereitgestellten Kisten im Zeitraum.</td></tr>
                ) : consInRange
                  .filter(c=>c.source==='crate' && !c.via_terminal)
                  .map(c=>{
                    const prof = Array.isArray(c.profiles)? c.profiles[0] : c.profiles
                    const d = Array.isArray(c.drinks)? c.drinks[0] : c.drinks
                    const userName = `${prof?.first_name||''} ${prof?.last_name||''}`.trim() || 'Unbekannt'
                    return (
                      <tr key={c.id} className="border-t border-gray-700">
                        <td className="p-2">{new Date(c.created_at).toLocaleString('de-DE')}</td>
                        <td className="p-2">{userName}</td>
                        <td className="p-2">{d?.name || 'Unbekannt'}</td>
                        <td className="p-2 text-right">{euro(c.unit_price_cents || 0)}</td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Toasts */}
        <AnimatePresence>
          {toasts.map(t=>(
            <motion.div key={t.id} initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-10}}
              className={`fixed bottom-5 right-5 px-4 py-2 rounded-lg shadow-lg ${t.type==='error'?'bg-red-700':'bg-green-700'}`}>
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </>
  )
}

function Stat({title,value}:{title:string;value:string}) {
  return (
    <div className="bg-gray-800/70 border border-gray-700 rounded-xl p-4 text-center shadow">
      <div className="text-gray-400 text-xs">{title}</div>
      <div className="text-lg font-semibold mt-1">{value}</div>
    </div>
  )
}
