/**
 * Base da API. Em desenvolvimento, "localhost" não funciona a partir de um
 * celular físico ou emulador — use o IP da sua máquina na rede local
 * (ex.: EXPO_PUBLIC_API_URL=http://192.168.0.10:3333) ou 10.0.2.2 no
 * emulador Android.
 */
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3333";
