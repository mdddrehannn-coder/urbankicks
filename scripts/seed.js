require("dotenv").config({ path: require("path").join(__dirname, "..", ".env.local") });
require("dotenv").config();

const { request, preferReturn } = require("../lib/supabase");
const { toProductRow } = require("../lib/mappers");

const products = [
  {
    name: "Air Pulse Runner",
    brand: "Nike",
    category: "Speed Runners",
    price: 12999,
    discountPercent: 35,
    imageUrl: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=1200&q=80",
    gallery: [
      "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1600185365483-26d7a4cc7519?auto=format&fit=crop&w=1200&q=80"
    ],
    description: "A responsive street runner with breathable mesh and daily comfort for fast city moves.",
    sizes: ["39", "40", "41", "42", "43", "44"],
    colors: ["Crimson", "White", "Black"],
    color: "Crimson",
    material: "Engineered mesh",
    stock: 18,
    rating: 4.8,
    reviewCount: 128,
    deliveryEstimate: "2-4 days",
    featured: true,
    trending: true
  },
  {
    name: "Ultraboost Avenue",
    brand: "Adidas",
    category: "Cloud Comfort",
    price: 14999,
    discountPercent: 30,
    imageUrl: "https://images.unsplash.com/photo-1608231387042-66d1773070a5?auto=format&fit=crop&w=1200&q=80",
    gallery: ["https://images.unsplash.com/photo-1608231387042-66d1773070a5?auto=format&fit=crop&w=1200&q=80"],
    description: "Premium knit runners with plush bounce for long campus days and city walks.",
    sizes: ["39", "40", "41", "42", "43", "44", "45"],
    colors: ["Cloud White", "Navy", "Volt"],
    color: "Cloud White",
    material: "Primeknit textile",
    stock: 14,
    rating: 4.7,
    reviewCount: 94,
    deliveryEstimate: "3-5 days",
    featured: true,
    trending: true
  },
  {
    name: "Velocity Nitro Street",
    brand: "Puma",
    category: "Arcade Trainers",
    price: 11999,
    discountPercent: 25,
    imageUrl: "https://images.unsplash.com/photo-1603808033192-082d6919d3e1?auto=format&fit=crop&w=1200&q=80",
    gallery: ["https://images.unsplash.com/photo-1603808033192-082d6919d3e1?auto=format&fit=crop&w=1200&q=80"],
    description: "Stable trainers with grippy rubber, cushioned landings, and gym-to-road durability.",
    sizes: ["39", "40", "41", "42", "43"],
    colors: ["Black", "Electric Green", "Silver"],
    color: "Black",
    material: "Mesh and rubber",
    stock: 19,
    rating: 4.6,
    reviewCount: 81,
    deliveryEstimate: "2-5 days",
    featured: true,
    trending: true
  },
  {
    name: "Chuck Metro High",
    brand: "Converse",
    category: "Hero High Tops",
    price: 6999,
    discountPercent: 20,
    imageUrl: "https://images.unsplash.com/photo-1494496195158-c3becb4f2475?auto=format&fit=crop&w=1200&q=80",
    gallery: ["https://images.unsplash.com/photo-1494496195158-c3becb4f2475?auto=format&fit=crop&w=1200&q=80"],
    description: "Canvas high-tops with classic lacing, rubber toe cap, and everyday flexibility.",
    sizes: ["38", "39", "40", "41", "42", "43", "44"],
    colors: ["Black", "Cream", "Red"],
    color: "Black",
    material: "Canvas",
    stock: 16,
    rating: 4.5,
    reviewCount: 66,
    deliveryEstimate: "3-6 days",
    featured: true,
    trending: false
  }
];

async function seed() {
  await request("/rest/v1/products", { method: "DELETE", headers: preferReturn() }).catch(() => null);
  await request("/rest/v1/products", {
    method: "POST",
    headers: preferReturn(),
    body: products.map(toProductRow)
  });
  console.log(`Seeded ${products.length} Urban Kicks products into Supabase.`);
}

seed().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
