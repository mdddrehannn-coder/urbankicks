function toProduct(row) {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    name: row.name,
    brand: row.brand,
    category: row.category,
    price: Number(row.price || 0),
    discountPercent: Number(row.discount_percent || 0),
    image: row.image || row.image_url,
    imageUrl: row.image_url || row.image,
    gallery: row.gallery || [],
    description: row.description,
    sizes: row.sizes || [],
    colors: row.colors || [],
    color: row.color || "",
    material: row.material || "",
    stock: Number(row.stock || 0),
    rating: Number(row.rating || 4.6),
    reviewCount: Number(row.review_count || 0),
    deliveryEstimate: row.delivery_estimate || "2-5 business days",
    codAvailable: row.cod_available !== false,
    featured: Boolean(row.featured),
    trending: Boolean(row.trending),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toProductRow(product) {
  const image = product.image || product.imageUrl;
  return {
    name: product.name,
    brand: product.brand || "Urban Kicks",
    category: product.category,
    price: Number(product.price || 0),
    discount_percent: Number(product.discountPercent || product.discount_percent || 0),
    image,
    image_url: product.imageUrl || image,
    gallery: product.gallery || [product.imageUrl || image].filter(Boolean),
    description: product.description,
    sizes: product.sizes || [],
    colors: product.colors || [],
    color: product.color || "",
    material: product.material || "",
    stock: Number(product.stock || 0),
    rating: Number(product.rating || 4.6),
    review_count: Number(product.reviewCount || product.review_count || 0),
    delivery_estimate: product.deliveryEstimate || product.delivery_estimate || "2-5 business days",
    cod_available: product.codAvailable !== false,
    featured: Boolean(product.featured),
    trending: Boolean(product.trending)
  };
}

function toOrder(row) {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    userId: row.user_id,
    customer: row.customer || {},
    items: row.items || [],
    subtotal: Number(row.subtotal || 0),
    shipping: Number(row.shipping || 0),
    total: Number(row.total || row.total_amount || 0),
    totalAmount: Number(row.total_amount || row.total || 0),
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status || "",
    paymentReference: row.payment_reference || "",
    status: row.status || row.order_status,
    orderStatus: row.order_status || row.status,
    addressId: row.address_id || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function parseList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

module.exports = {
  toProduct,
  toProductRow,
  toOrder,
  parseList
};
