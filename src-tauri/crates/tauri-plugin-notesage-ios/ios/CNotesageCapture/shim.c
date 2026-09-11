//
//  Intentionally empty.
//
//  SwiftPM requires a C target to have at least one source file, but this
//  target is a set of DECLARATIONS only: the definitions live in the Rust
//  static library the app already links (see the header for why). A function
//  body here would be a second implementation of something Rust owns.
//
