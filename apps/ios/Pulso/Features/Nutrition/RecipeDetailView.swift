import SwiftUI

/// A recipe: time, portions and a portion's macros as the hero, then the
/// ingredients for the whole pot and the steps.
struct RecipeDetailView: View {
    let recipeId: String
    @State private var recipe: Recipe?
    @State private var failed = false
    @State private var savedAsDish = false

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                if let recipe {
                    RecipeContent(recipe: recipe)
                } else if failed {
                    EmptyStateView(systemImage: "book.closed", title: "No se pudo abrir la receta",
                                   message: "Puede que la Mac no esté a mano.", tint: Theme.energy, actionTitle: "Reintentar") {
                        Task { await load() }
                    }
                    .padding(.top, 40)
                } else {
                    ProgressView().controlSize(.large).padding(.top, 120)
                }
            }
            .padding(.horizontal)
            .padding(.bottom, 24)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(recipe?.name ?? "Receta")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if recipe != nil {
                ToolbarItem(placement: .primaryAction) {
                    Button(savedAsDish ? "En Mis platillos" : "Guardar como platillo", systemImage: savedAsDish ? "bookmark.fill" : "bookmark") {
                        Task { await saveAsDish() }
                    }
                    .disabled(savedAsDish)
                    .symbolEffect(.bounce, value: savedAsDish)
                }
            }
        }
        .sensoryFeedback(.success, trigger: savedAsDish) { _, new in new }
        .task { await load() }
    }

    /// One portion of the recipe into Mis platillos, to log it in one tap any day.
    private func saveAsDish() async {
        guard let api = PulsoModel.shared.api else { return }
        do {
            _ = try await api.saveRecipeAsDish(recipeId)
            savedAsDish = true
        } catch {
            PulsoModel.shared.handle(error)
        }
    }

    private func load() async {
        guard let api = PulsoModel.shared.api else { return }
        failed = false
        do {
            recipe = try await api.recipe(recipeId)
        } catch {
            failed = true
            PulsoModel.shared.handle(error)
        }
    }
}

struct RecipeContent: View {
    let recipe: Recipe

    private var portions: String {
        let n = Int(recipe.servings)
        return n == 1 ? "1 porción" : "\(n) porciones"
    }

    var body: some View {
        HeroCard(title: recipe.isQuick ? "Receta rápida" : "Receta", systemImage: "frying.pan",
                 value: "\(Int(recipe.prepMinutes))", unit: "min", caption: portions, tint: Theme.energy) {
            VStack(alignment: .leading, spacing: 6) {
                Text(recipe.name).font(.title3.weight(.semibold))
                HStack(spacing: 6) {
                    Text("\(Int(recipe.perServing.kcal)) kcal por porción")
                    Text("·")
                    MacroLine(macros: recipe.perServing)
                }
                .font(.caption.monospacedDigit()).fontDesign(.rounded)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                if recipe.batch {
                    GlassChip("Aguanta varios días", systemImage: "takeoutbag.and.cup.and.straw", tint: Theme.body)
                }
            }
        }
        Card {
            CardTitle(text: "Ingredientes · para \(portions)", systemImage: "basket")
            ForEach(recipe.ingredients) { ingredient in
                HStack(alignment: .firstTextBaseline) {
                    Text(ingredient.name)
                    Spacer(minLength: 8)
                    Text(ingredient.amountText)
                        .font(.subheadline.monospacedDigit()).fontDesign(.rounded)
                        .foregroundStyle(.secondary)
                }
                if ingredient.id != recipe.ingredients.last?.id { Divider() }
            }
        }
        if let steps = recipe.steps, !steps.isEmpty {
            Card {
                CardTitle(text: "Cómo se hace", systemImage: "list.number")
                Text(steps).font(.body)
            }
        }
    }
}

// MARK: - Previews

private let previewRecipe = Recipe(
    id: "r1", name: "Pollo con arroz y verduras", servings: 4, prepMinutes: 40, batch: true,
    ingredients: [
        RecipeIngredient(name: "Pechuga de pollo", quantity: 800, unit: .g, kcal: 880, protein: 184, carbs: 0, fat: 12, fiber: 0),
        RecipeIngredient(name: "Arroz", quantity: 320, unit: .g, kcal: 1_150, protein: 22, carbs: 250, fat: 2, fiber: 4),
        RecipeIngredient(name: "Pimiento rojo", quantity: 2, unit: .unidad, kcal: 60, protein: 2, carbs: 12, fat: 0, fiber: 4),
    ],
    perServing: NutritionMacros(kcal: 522, protein: 52, carbs: 65, fat: 3.5, fiber: 2),
    steps: "Dora el pollo en dados. Añade las verduras y el arroz, cubre con caldo y cocina 18 minutos."
)

#Preview("Receta · 375 pt · XXL") {
    NarrowPreview(dynamicType: .xxLarge) { RecipeContent(recipe: previewRecipe) }
}

#Preview("Receta · claro") {
    NarrowPreview { RecipeContent(recipe: previewRecipe) }.preferredColorScheme(.light)
}
