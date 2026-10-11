import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertIndexMatches,
  canSee,
  EMBEDDING_DIMENSIONS,
  findVisibleDocument,
  inForceOn,
  rankChunks,
  requireIndex,
  visibleDocuments,
  visibleTo,
} from './retrieval';
import { NotFoundError } from '../../shared/domain/errors';
import { referenceDate } from '../../shared/domain/reference-date';
import { chunkFactory, documentRecordFactory } from '../../../tests/fixtures/factories';

describe('EMBEDDING_DIMENSIONS', () => {
  it('should size every index vector at 1536 dimensions', () => {
    // Arrange
    // Act
    const dimensions = EMBEDDING_DIMENSIONS;
    // Assert
    assert.equal(dimensions, 1536);
  });
});

describe('canSee', () => {
  it('should let operators see internal documents', () => {
    // Arrange
    const audience = 'internal';
    // Act
    const visible = canSee('operator', audience);
    // Assert
    assert.equal(visible, true);
  });

  it('should keep only public ones for customers', () => {
    // Arrange
    const audiences = ['public', 'internal'];
    // Act
    const visible = audiences.filter((audience) => canSee('customer', audience));
    // Assert
    assert.deepEqual(visible, ['public']);
  });
});

describe('inForceOn', () => {
  it('should keep chunks in force on the reference date', () => {
    // Arrange
    const chunks = [
      chunkFactory.build({ validFrom: '2026-01-01', validTo: null }),
      chunkFactory.build({ validFrom: null, validTo: referenceDate }),
      chunkFactory.build({ validFrom: '2026-01-01', validTo: '2026-08-31' }),
      chunkFactory.build({ validFrom: '2026-10-01', validTo: null }),
    ];
    // Act
    const inForce = chunks.map((c) => inForceOn(c, referenceDate));
    // Assert
    assert.deepEqual(inForce, [true, true, false, false]);
  });
});

describe('visibleTo', () => {
  it('should require both the audience and the validity on the given date', () => {
    // Arrange
    const chunks = [
      chunkFactory.build({ audience: 'public', validTo: null }),
      chunkFactory.build({ audience: 'internal', validTo: null }),
      chunkFactory.build({ audience: 'public', validTo: '2026-08-31' }),
    ];
    // Act
    const visible = chunks.filter(visibleTo('customer', referenceDate));
    // Assert
    assert.deepEqual(visible, [chunks[0]]);
  });
});

describe('rankChunks', () => {
  it('should rank by dot product and cut to the limit', () => {
    // Arrange
    const chunks = [
      chunkFactory.build({ vector: [0, 1] }),
      chunkFactory.build({ vector: [1, 0] }),
      chunkFactory.build({ vector: [0.5, 0.5] }),
    ];
    // Act
    const ranked = rankChunks(chunks, [1, 0], 2);
    // Assert
    assert.deepEqual(
      ranked.map((r) => [r.id, r.score]),
      [
        [chunks[1].id, 1],
        [chunks[2].id, 0.5],
      ],
    );
  });

  it('should return passages without their vectors', () => {
    // Arrange
    const chunks = [chunkFactory.build({ vector: [1, 0] })];
    // Act
    const [ranked] = rankChunks(chunks, [1, 0], 5);
    // Assert
    assert.equal('vector' in ranked, false);
  });

  it('should reject incompatible dimensions', () => {
    // Arrange
    const chunks = [chunkFactory.build({}, { dimensions: 3 })];
    // Act & Assert
    assert.throws(() => rankChunks(chunks, [1, 0], 5), {
      message: 'Incompatible embedding dimensions.',
    });
  });
});

describe('requireIndex', () => {
  it('should report a missing index', () => {
    // Arrange
    const model = undefined;
    // Act & Assert
    assert.throws(() => requireIndex(model), {
      message: 'No document index. Run npm run setup or npm run ingest.',
    });
  });

  it('should return the model of an existing index', () => {
    // Arrange
    const model = 'text-embedding-3-small';
    // Act
    const indexed = requireIndex(model);
    // Assert
    assert.equal(indexed, model);
  });
});

describe('assertIndexMatches', () => {
  it('should report a model mismatch', () => {
    // Arrange
    const indexModel = 'another-embedding-model';
    // Act & Assert
    assert.throws(() => assertIndexMatches(indexModel, 'text-embedding-3-small'), {
      message: 'The model does not match the index. Re-ingest the documents.',
    });
  });

  it('should accept an index built with the configured model', () => {
    // Arrange
    const model = 'text-embedding-3-small';
    // Act & Assert
    assert.doesNotThrow(() => assertIndexMatches(model, model));
  });
});

describe('visibleDocuments', () => {
  it('should keep only public documents for customers and every document for operators', () => {
    // Arrange
    const docs = [
      documentRecordFactory.build({ audience: 'public' }),
      documentRecordFactory.build({ audience: 'internal' }),
    ];
    // Act
    const forCustomer = visibleDocuments('customer', docs);
    const forOperator = visibleDocuments('operator', docs);
    // Assert
    assert.deepEqual(forCustomer, [docs[0]]);
    assert.deepEqual(forOperator, docs);
  });
});

describe('findVisibleDocument', () => {
  it('should report an invisible document as not found', () => {
    // Arrange
    const internal = documentRecordFactory.build({ audience: 'internal' });
    // Act & Assert
    assert.throws(
      () => findVisibleDocument('customer', [internal], internal.id),
      (e) => {
        assert.ok(e instanceof NotFoundError);
        assert.equal(e.message, 'Document not found.');
        return true;
      },
    );
  });

  it('should find a visible document by its id', () => {
    // Arrange
    const docs = documentRecordFactory.buildList(3);
    // Act
    const found = findVisibleDocument('customer', docs, docs[1].id);
    // Assert
    assert.equal(found, docs[1]);
  });
});
