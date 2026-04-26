import axios from "axios";

const client = axios.create({
  baseURL: (import.meta.env.VITE_API_BASE_URL ?? "") + "/api",
});

export async function planTrip(payload) {
  const { data } = await client.post("/trip/plan/", payload);
  return data;
}

export async function autocompletePlace(query, signal) {
  const q = (query ?? "").trim();
  if (q.length < 2) return [];
  const { data } = await client.get("/places/autocomplete/", {
    params: { q },
    signal,
  });
  return data?.results ?? [];
}
