/**
 * Ocupa el lugar de @supabase/realtime-js en el build (ver vite.config.ts). El tiempo real pesa unos 18 KB comprimidos
 * y la pantalla inicial no lo necesita: mientras no llega, useLiveData lee el servidor cada 20 s.
 * El código se trae con el primer toque o tecla, o a los 20 s si nadie toca nada. Entonces se crean de verdad
 * los canales que ya se habían pedido, con sus escuchas y su suscripción, en el mismo orden.
 */
import type { RealtimeChannel, RealtimeClient as ClienteReal, RealtimeClientOptions, RealtimeRemoveChannelResponse } from "@supabase/realtime-js/dist/module/index.js";

type Modulo = typeof import("@supabase/realtime-js/dist/module/index.js");
type Args = unknown[];

/** Lo mismo que espera useLiveData antes de volver a leer cuando no hay tiempo real. */
const ESPERA_MS = 20_000;

let modulo: Promise<Modulo> | null = null;

function traerModulo(): Promise<Modulo> {
  modulo ??= new Promise<void>((listo) => {
    if (typeof window === "undefined") return listo();
    const fin = () => {
      window.clearTimeout(reloj);
      window.removeEventListener("pointerdown", fin, true);
      window.removeEventListener("keydown", fin, true);
      listo();
    };
    const reloj = window.setTimeout(fin, ESPERA_MS);
    window.addEventListener("pointerdown", fin, true);
    window.addEventListener("keydown", fin, true);
  })
    .then(() => import("@supabase/realtime-js/dist/module/index.js"))
    .catch((e: unknown) => {
      // Sin red y sin la pieza guardada: el próximo canal lo vuelve a intentar.
      modulo = null;
      throw e;
    });
  return modulo;
}

/** Canal pedido antes de que llegue el cliente real: guarda lo que se le pide y lo repite después. */
class CanalDiferido {
  real: RealtimeChannel | null = null;
  quitado = false;
  private readonly escuchas: Args[] = [];
  private suscripcion: Args | null = null;

  constructor(
    readonly topic: string,
    private readonly opciones: unknown,
  ) {}

  on(...args: Args) {
    if (this.real) (this.real.on as (...a: Args) => unknown)(...args);
    else this.escuchas.push(args);
    return this;
  }

  subscribe(...args: Args) {
    if (this.real) (this.real.subscribe as (...a: Args) => unknown)(...args);
    else this.suscripcion = args;
    return this;
  }

  crear(cliente: ClienteReal) {
    if (this.quitado || this.real) return;
    const c = (cliente.channel as (...a: Args) => RealtimeChannel)(this.topic, this.opciones);
    for (const a of this.escuchas) (c.on as (...a: Args) => unknown)(...a);
    if (this.suscripcion) (c.subscribe as (...a: Args) => unknown)(...this.suscripcion);
    this.real = c;
  }
}

export class RealtimeClient {
  private real: ClienteReal | null = null;
  private pedido = false;
  private ultimaAuth: Args | null = null;
  private readonly canales = new Set<CanalDiferido>();

  constructor(
    private readonly url: string,
    private readonly opciones?: RealtimeClientOptions,
  ) {}

  private traer() {
    if (this.pedido) return;
    this.pedido = true;
    traerModulo().then(
      (m) => {
        const r = new m.RealtimeClient(this.url, this.opciones);
        if (this.ultimaAuth) (r.setAuth as (...a: Args) => Promise<void>)(...this.ultimaAuth).catch((e: unknown) => console.warn("[tiempo real] sesión", e));
        this.real = r;
        for (const c of this.canales) c.crear(r);
      },
      (e: unknown) => {
        this.pedido = false;
        console.warn("[tiempo real] no se pudo cargar", e);
      },
    );
  }

  setAuth(...args: Args): Promise<void> {
    this.ultimaAuth = args;
    return this.real ? (this.real.setAuth as (...a: Args) => Promise<void>)(...args) : Promise.resolve();
  }

  channel(topic: string, opciones?: unknown) {
    const c = new CanalDiferido(topic, opciones);
    this.canales.add(c);
    if (this.real) c.crear(this.real);
    else this.traer();
    return c;
  }

  getChannels() {
    return this.real ? this.real.getChannels() : [];
  }

  async removeChannel(c: CanalDiferido): Promise<RealtimeRemoveChannelResponse> {
    this.canales.delete(c);
    c.quitado = true;
    return c.real && this.real ? this.real.removeChannel(c.real) : "ok";
  }

  async removeAllChannels(): Promise<RealtimeRemoveChannelResponse[]> {
    const todos = Array.from(this.canales);
    return Promise.all(todos.map((c) => this.removeChannel(c)));
  }
}
