import SwiftUI

/// Onboarding's last step: the Mac's tailnet address (prefilled) and the eight
/// digits the desktop app shows. Completing the eighth digit pairs right away.
struct PairView: View {
    let model: PulsoModel
    @State private var address = CredentialStore.address
    @State private var code = ""
    @State private var editingAddress = false
    @FocusState private var focused: Field?

    private enum Field { case address, code }

    private var ready: Bool { code.count == Pairing.codeLength && Pairing.baseURL(from: address) != nil && !model.pairing }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                Image(systemName: "laptopcomputer.and.iphone")
                    .font(.system(size: 50, weight: .medium))
                    .foregroundStyle(Theme.brandGradient)
                    .symbolEffect(.bounce, value: model.credentials != nil)
                    .frame(width: 112, height: 112)
                    .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
                    .padding(.top, 24)
                Text("Empareja tu Mac")
                    .font(.system(size: 34, weight: .bold, design: .rounded))
                    .padding(.top, 24)
                Text("En Pulso para Mac: iPhone → Generar código. Vale cinco minutos y una vez.")
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.top, 8)
                    .padding(.horizontal, 28)

                CodeField(code: $code, focused: $focused, field: .code, failed: model.pairingError != nil)
                    .padding(.top, 32)
                    .padding(.horizontal, 20)

                PasteButton(payloadType: String.self) { strings in
                    guard let text = strings.first else { return }
                    Task { @MainActor in code = Pairing.normalizeCode(text) }
                }
                .buttonBorderShape(.capsule)
                .labelStyle(.titleAndIcon)
                .padding(.top, 14)

                if let error = model.pairingError {
                    ErrorNote(message: error)
                        .padding(.top, 20)
                        .padding(.horizontal, 24)
                        .transition(.move(edge: .top).combined(with: .opacity))
                }

                addressRow
                    .padding(.top, 28)
                    .padding(.horizontal, 24)
            }
            .animation(.snappy, value: model.pairingError)
            .animation(.snappy, value: editingAddress)
        }
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) {
            PrimaryButton(title: model.pairing ? "Emparejando…" : "Emparejar", busy: model.pairing, disabled: !ready, action: submit)
                .padding(.top, 8)
        }
        .onChange(of: code) { _, next in
            let clean = Pairing.normalizeCode(next)
            if clean != next { code = clean; return }
            if !clean.isEmpty { model.pairingError = nil }
            if clean.count == Pairing.codeLength && ready { submit() }
        }
        .sensoryFeedback(.error, trigger: model.pairingError) { _, new in new != nil }
        .sensoryFeedback(.success, trigger: model.credentials != nil) { _, paired in paired }
        .onAppear { focused = .code }
    }

    /// The address is usually right (it was prefilled), so it reads as a quiet line
    /// with an "Editar" that turns it into a field.
    @ViewBuilder private var addressRow: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("Dirección de la Mac", systemImage: "network")
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(.secondary)
                Spacer()
                Button(editingAddress ? "Listo" : "Editar") {
                    editingAddress.toggle()
                    focused = editingAddress ? .address : .code
                }
                .font(.footnote.weight(.semibold))
            }
            if editingAddress {
                TextField("http://100.x.x.x:8090", text: $address)
                    .keyboardType(.URL)
                    .textContentType(.URL)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .font(.body.monospaced())
                    .focused($focused, equals: .address)
                    .submitLabel(.done)
                    .onSubmit { editingAddress = false; focused = .code }
                    .padding(12)
                    .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                Text("La que muestra Pulso en la Mac junto al código: su IP de Tailscale y el puerto 8090.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                Text(address.isEmpty ? "Sin dirección" : address)
                    .font(.callout.monospaced())
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
        .padding(14)
        .background(.background.secondary.opacity(0.6), in: RoundedRectangle(cornerRadius: Theme.corner, style: .continuous))
    }

    private func submit() {
        guard ready else { return }
        focused = nil
        editingAddress = false
        Task { await model.pair(address: address, code: code) }
    }
}

/// Eight large monospaced digit boxes (4 · 4) over one invisible field, so the
/// keyboard, one-time-code autofill and paste all work like any text field.
private struct CodeField<Field: Hashable>: View {
    @Binding var code: String
    var focused: FocusState<Field?>.Binding
    let field: Field
    var failed: Bool

    var body: some View {
        ZStack {
            TextField("", text: $code)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .focused(focused, equals: field)
                .foregroundStyle(.clear)
                .tint(.clear)
                .frame(width: 1, height: 1)
                .opacity(0.02)
                .accessibilityLabel("Código de ocho dígitos")
            HStack(spacing: 6) {
                ForEach(0..<Pairing.codeLength, id: \.self) { index in
                    if index == Pairing.codeLength / 2 {
                        Capsule().fill(.tertiary).frame(width: 10, height: 3).padding(.horizontal, 2)
                    }
                    box(index)
                }
            }
            .contentShape(Rectangle())
            .onTapGesture { focused.wrappedValue = field }
            .accessibilityHidden(true)
        }
        .modifier(Shake(amount: failed ? 1 : 0))
        .animation(.snappy, value: code)
        .animation(.default, value: failed)
    }

    private func box(_ index: Int) -> some View {
        let digits = Array(code)
        let digit = index < digits.count ? String(digits[index]) : ""
        let active = focused.wrappedValue == field && index == min(digits.count, Pairing.codeLength - 1)
        return Text(digit)
            .font(.system(size: 30, weight: .semibold, design: .monospaced))
            .contentTransition(.numericText())
            .frame(maxWidth: .infinity)
            .frame(height: 60)
            .glassEffect(.regular.interactive(), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(failed ? Theme.caution : Color.accentColor, lineWidth: active || failed ? 2 : 0)
            }
    }
}

/// A gentle horizontal shake when a code is refused.
private struct Shake: GeometryEffect {
    var amount: CGFloat
    var animatableData: CGFloat {
        get { amount }
        set { amount = newValue }
    }

    func effectValue(size: CGSize) -> ProjectionTransform {
        ProjectionTransform(CGAffineTransform(translationX: 8 * sin(amount * .pi * 4), y: 0))
    }
}

/// A refusal or a transport problem, in a soft orange card the person can read calmly.
private struct ErrorNote: View {
    let message: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Theme.caution)
                .symbolEffect(.bounce, value: message)
            Text(LocalizedStringKey(message))
                .font(.subheadline)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(14)
        .background(Theme.caution.opacity(0.12), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
