# JWT access-token type compatibility

The `typ` header accepts `at+jwt` and `application/at+jwt`, including ASCII case variants. This follows [RFC 9068 section 4](https://www.rfc-editor.org/rfc/rfc9068.html#section-4) and the media-type comparison rules in [RFC 7515 section 4.1.9](https://www.rfc-editor.org/rfc/rfc7515.html#section-4.1.9).

Missing or non-string types, ID-token types such as `JWT`, other media types, parameters, whitespace, duplicate prefixes and malformed forms remain invalid. The check does not trim whitespace or decode escaped media-type names. JWT signature verification, configured algorithms and JWKS location, issuer, audience, subject, scope and time checks continue to apply.

Signed-token regression tests cover the registered forms, mixed case, unrelated and malformed types, invalid signatures, expiration and audience mismatch. HTTP tests exercise accepted forms through an authorized tool call and verify that rejected forms return 401 without reaching a tool. This corrects an interoperability rejection in alpha.2; it does not establish a new artifact or replace the frozen alpha.2 evidence.
