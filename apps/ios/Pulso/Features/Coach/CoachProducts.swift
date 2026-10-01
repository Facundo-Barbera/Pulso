import SwiftUI

/// A product scanned in the composer, looked up while the person writes.
struct ChatProduct: Identifiable, Equatable {
    let id = UUID()
    let barcode: String
    var product: FoodProduct?
    var resolving = true

    var sent: AgentProduct { AgentProduct(barcode: barcode, product: product) }
}

/// The barcode scanner, just to hand a code to the chat; the lookup happens in the composer.
struct ProductScanSheet: View {
    let onCode: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            BarcodeCapture { code in
                onCode(code)
                dismiss()
            }
            .navigationTitle("Escanear producto")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cerrar") { dismiss() } }
            }
        }
    }
}

/// Thumbnail, name, brand and energy per 100 g (or ml): the same look in the composer and the chat.
struct ProductCard: View {
    let barcode: String
    let product: FoodProduct?
    var resolving = false

    var body: some View {
        HStack(spacing: 10) {
            thumbnail
            VStack(alignment: .leading, spacing: 1) {
                if let product {
                    Text(product.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                    if let brand = product.brand, !brand.isEmpty {
                        Text(brand).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Text("\(Int(product.per100g.kcal)) kcal / 100 \(product.unit.rawValue)")
                        .font(.caption.weight(.semibold))
                        .fontDesign(.rounded)
                        .foregroundStyle(Theme.energy)
                } else {
                    Text(resolving ? "Buscando producto…" : "Producto desconocido").font(.subheadline.weight(.semibold))
                    Text(barcode).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                }
            }
        }
        .padding(8)
        .padding(.trailing, 6)
        .frame(maxWidth: 250, alignment: .leading)
        .animation(.snappy, value: resolving)
        .accessibilityElement(children: .combine)
    }

    private var thumbnail: some View {
        ZStack {
            Rectangle().fill(.fill.tertiary)
            if let url = product?.imageUrl.flatMap(URL.init(string:)) {
                AsyncImage(url: url) { image in
                    image.resizable().scaledToFit()
                } placeholder: {
                    symbol
                }
            } else {
                symbol
            }
        }
        .frame(width: 48, height: 48)
        .clipShape(.rect(cornerRadius: 12, style: .continuous))
    }

    private var symbol: some View {
        Image(systemName: resolving ? "barcode.viewfinder" : product == nil ? "questionmark.app.dashed" : product?.isLiquid == true ? "waterbottle" : "shippingbox")
            .font(.title3)
            .foregroundStyle(.secondary)
            .symbolEffect(.pulse, isActive: resolving)
            .contentTransition(.symbolEffect(.replace))
    }
}

/// The person's scanned products on a sent message, right-aligned above the bubble.
struct MessageProducts: View {
    let products: [AgentProduct]

    var body: some View {
        VStack(alignment: .trailing, spacing: 6) {
            ForEach(Array(products.enumerated()), id: \.offset) { _, item in
                ProductCard(barcode: item.barcode, product: item.product)
                    .background(.background.secondary, in: .rect(cornerRadius: 18, style: .continuous))
            }
        }
    }
}
