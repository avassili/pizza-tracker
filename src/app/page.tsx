"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

const STAGES = [
  { id: "ordered", label: "Ordered", detail: "Ticket is in the kitchen" },
  { id: "prep", label: "Prep", detail: "Dough stretched, toppings on" },
  { id: "baking", label: "Baking", detail: "In the oven at 500°" },
  { id: "delivery", label: "Out for delivery", detail: "Hot bag, on the road" },
  { id: "delivered", label: "Delivered", detail: "Enjoy the pie" },
] as const;

type StageId = (typeof STAGES)[number]["id"];

const SIZES = ["Small", "Medium", "Large", "XL"] as const;
const TOPPINGS = ["Pepperoni", "Mushrooms", "Olives", "Peppers", "Onion", "Extra cheese"] as const;

type Order = {
  id: string;
  name: string;
  size: (typeof SIZES)[number];
  toppings: string[];
  stageIndex: number;
  placedAt: number;
};

function nextId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export default function Home() {
  const [name, setName] = useState("");
  const [size, setSize] = useState<(typeof SIZES)[number]>("Large");
  const [toppings, setToppings] = useState<string[]>(["Pepperoni"]);
  const [orders, setOrders] = useState<Order[]>([]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setOrders((current) =>
        current.map((order) =>
          order.stageIndex >= STAGES.length - 1
            ? order
            : { ...order, stageIndex: order.stageIndex + 1 },
        ),
      );
    }, 4000);

    return () => window.clearInterval(timer);
  }, []);

  const active = orders[0];
  const stage: StageId | null = active ? STAGES[active.stageIndex].id : null;

  const eta = useMemo(() => {
    if (!active) return null;
    const remaining = STAGES.length - 1 - active.stageIndex;
    if (remaining === 0) return "Arrived";
    return `~${remaining * 4} min`;
  }, [active]);

  function toggleTopping(item: string) {
    setToppings((current) =>
      current.includes(item) ? current.filter((t) => t !== item) : [...current, item],
    );
  }

  function placeOrder(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;

    setOrders((current) => [
      {
        id: nextId(),
        name: name.trim(),
        size,
        toppings,
        stageIndex: 0,
        placedAt: Date.now(),
      },
      ...current,
    ]);
    setName("");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-10 px-6 py-12">
      <header className="flex flex-col gap-3">
        <p className="text-sm tracking-[0.3em] text-amber-300 uppercase">Wood-fired since never</p>
        <h1 className="text-5xl leading-tight font-bold text-amber-50 sm:text-6xl">Pizza Tracker</h1>
        <p className="max-w-xl text-lg text-amber-100/80">
          One page. One pie. Watch your order move from ticket to table.
        </p>
      </header>

      <section className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <form
          onSubmit={placeOrder}
          className="rounded-3xl border border-amber-200/15 bg-black/25 p-6 shadow-[0_20px_80px_rgba(0,0,0,0.35)]"
        >
          <h2 className="mb-5 text-2xl text-amber-100">Build your pie</h2>

          <label className="mb-4 block text-sm text-amber-200/80">
            Name on the box
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Dmitriy"
              className="mt-2 w-full rounded-xl border border-amber-100/15 bg-[#1a0f0a] px-4 py-3 text-amber-50 outline-none focus:border-amber-300"
            />
          </label>

          <label className="mb-4 block text-sm text-amber-200/80">
            Size
            <select
              value={size}
              onChange={(e) => setSize(e.target.value as (typeof SIZES)[number])}
              className="mt-2 w-full rounded-xl border border-amber-100/15 bg-[#1a0f0a] px-4 py-3 text-amber-50 outline-none focus:border-amber-300"
            >
              {SIZES.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </label>

          <fieldset className="mb-6">
            <legend className="mb-3 text-sm text-amber-200/80">Toppings</legend>
            <div className="flex flex-wrap gap-2">
              {TOPPINGS.map((item) => {
                const on = toppings.includes(item);
                return (
                  <button
                    key={item}
                    type="button"
                    onClick={() => toggleTopping(item)}
                    className={`rounded-full px-4 py-2 text-sm transition ${
                      on
                        ? "bg-orange-600 text-white"
                        : "border border-amber-100/20 bg-transparent text-amber-100"
                    }`}
                  >
                    {item}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <button
            type="submit"
            className="w-full rounded-2xl bg-orange-600 py-3 text-lg font-semibold text-white transition hover:bg-orange-500"
          >
            Place order
          </button>
        </form>

        <div className="rounded-3xl border border-amber-200/15 bg-black/25 p-6">
          {!active ? (
            <p className="text-amber-100/70">No live order yet. Drop a pizza in the oven.</p>
          ) : (
            <div className="flex flex-col gap-5">
              <div>
                <p className="text-xs tracking-widest text-amber-300 uppercase">Order #{active.id}</p>
                <h2 className="text-3xl text-amber-50">{active.name}</h2>
                <p className="text-amber-100/75">
                  {active.size} · {active.toppings.length ? active.toppings.join(", ") : "Cheese"}
                </p>
                <p className="mt-2 text-amber-200">ETA {eta}</p>
              </div>

              <ol className="space-y-3">
                {STAGES.map((item, index) => {
                  const done = index < active.stageIndex;
                  const current = index === active.stageIndex;
                  return (
                    <li
                      key={item.id}
                      className={`rounded-2xl border px-4 py-3 ${
                        current
                          ? "border-amber-300 bg-orange-700/40"
                          : done
                            ? "border-amber-100/20 bg-amber-100/5"
                            : "border-amber-100/10 opacity-50"
                      }`}
                    >
                      <p className="font-semibold text-amber-50">
                        {done ? "✓ " : current ? "● " : "○ "}
                        {item.label}
                      </p>
                      <p className="text-sm text-amber-100/80">{item.detail}</p>
                    </li>
                  );
                })}
              </ol>
              {stage === "delivered" && (
                <p className="text-center text-amber-200">This pie has landed. Order another?</p>
              )}
            </div>
          )}
        </div>
      </section>

      {orders.length > 1 && (
        <section>
          <h2 className="mb-3 text-xl text-amber-100">Earlier pies</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {orders.slice(1).map((order) => (
              <li key={order.id} className="rounded-2xl border border-amber-100/10 bg-black/20 px-4 py-3">
                <p className="text-amber-50">
                  #{order.id} · {order.name}
                </p>
                <p className="text-sm text-amber-100/70">
                  {order.size} · {STAGES[order.stageIndex].label}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
