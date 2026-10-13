'use client';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useFormik } from 'formik';
import * as Yup from 'yup';
import styles from '../adminDashboard.module.css';
import LocationPicker from '../../../../components/LocationPicker';

// Helper to convert GeoJSON [longitude, latitude] into Leaflet { lat: latitude, lng: longitude }
const extractProductLocation = (loc) => {
  if (!loc) return null;
  // GeoJSON Point stores coordinates in [longitude, latitude] order
  if (Array.isArray(loc.coordinates) && loc.coordinates.length === 2) {
    const lng = Number(loc.coordinates[0]);
    const lat = Number(loc.coordinates[1]);
    if (!isNaN(lat) && !isNaN(lng)) {
      return { lat, lng, displayName: loc.name || loc.address || '' };
    }
  }
  if (loc.lat !== undefined && loc.lng !== undefined) {
    const lat = Number(loc.lat);
    const lng = Number(loc.lng);
    if (!isNaN(lat) && !isNaN(lng)) {
      return { lat, lng, displayName: loc.displayName || loc.name || '' };
    }
  }
  return null;
};

// Yup Validation Schema for Products
const productValidationSchema = Yup.object().shape({
  title: Yup.string()
    .trim()
    .required('Product title is required')
    .min(2, 'Title must be at least 2 characters')
    .max(100, 'Title cannot exceed 100 characters'),
  description: Yup.string()
    .trim()
    .required('Product description is required')
    .min(5, 'Description must be at least 5 characters')
    .max(1000, 'Description cannot exceed 1000 characters'),
  price: Yup.number()
    .typeError('Price must be a valid number')
    .required('Price is required')
    .min(0, 'Price must be non-negative (>= 0)'),
  quantity: Yup.number()
    .typeError('Quantity must be a valid number')
    .required('Quantity is required')
    .min(0, 'Quantity must be non-negative (>= 0)'),
  category: Yup.string()
    .trim()
    .max(50, 'Category cannot exceed 50 characters'),
  status: Yup.string()
    .oneOf(['active', 'inactive'], 'Status must be active or inactive')
    .required('Status is required'),
});

export default function ProductsManager({ token, triggerToast, onCountChange }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filter & Search states
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 6;

  // File input refs for clearing
  const addFileInputRef = useRef(null);
  const editFileInputRef = useRef(null);

  // ==========================================
  // ADD PRODUCT MODAL STATE
  // ==========================================
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [addImageFile, setAddImageFile] = useState(null);
  const [addPreviewUrl, setAddPreviewUrl] = useState(null);
  const [addLocation, setAddLocation] = useState(null);
  const [addLocationError, setAddLocationError] = useState('');

  const handleAddLocationChange = (loc) => {
    setAddLocation(loc);
    setAddLocationError('');
  };

  // ==========================================
  // EDIT PRODUCT MODAL STATE
  // ==========================================
  const [editingProduct, setEditingProduct] = useState(null);
  const [loadingEditProduct, setLoadingEditProduct] = useState(false);
  const [editImageFile, setEditImageFile] = useState(null);
  const [editPreviewUrl, setEditPreviewUrl] = useState(null);
  const [editLocation, setEditLocation] = useState(null);
  const [editLocationError, setEditLocationError] = useState('');

  const handleEditLocationChange = (loc) => {
    setEditLocation(loc);
    setEditLocationError('');
  };

  // ==========================================
  // VIEW & DELETE MODAL STATES
  // ==========================================
  const [viewingProductId, setViewingProductId] = useState(null);
  const [viewingProduct, setViewingProduct] = useState(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewError, setViewError] = useState(null);
  const [deletingProduct, setDeletingProduct] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Fetch all products from API
  const fetchProducts = async (isManual = false) => {
    if (!token) return;
    try {
      if (isManual) setRefreshing(true);
      else setLoading(true);

      const res = await fetch('/api/products', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to fetch products');
      }

      if (data.success && Array.isArray(data.data)) {
        setProducts(data.data);
        if (onCountChange) onCountChange(data.data.length);
        if (isManual && triggerToast) {
          triggerToast(`Loaded ${data.data.length} products!`, 'success');
        }
      }
    } catch (err) {
      if (triggerToast) {
        triggerToast(err.message || 'Error fetching products', 'error');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, [token]);

  // Derived unique categories for filter dropdown
  const categories = useMemo(() => {
    const set = new Set();
    products.forEach((p) => {
      if (p.category && p.category.trim()) set.add(p.category.trim());
    });
    return ['ALL', ...Array.from(set)];
  }, [products]);

  // Filtered products list
  const filteredProducts = useMemo(() => {
    return products.filter((prod) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        prod.title?.toLowerCase().includes(q) ||
        prod.description?.toLowerCase().includes(q);

      const matchesCategory =
        categoryFilter === 'ALL' ||
        (prod.category && prod.category.toLowerCase() === categoryFilter.toLowerCase());

      const matchesStatus =
        statusFilter === 'ALL' ||
        (prod.status && prod.status.toLowerCase() === statusFilter.toLowerCase());

      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [products, searchQuery, categoryFilter, statusFilter]);

  // Reset to page 1 on filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, categoryFilter, statusFilter]);

  // Pagination calculation
  const totalPages = Math.ceil(filteredProducts.length / itemsPerPage) || 1;
  const paginatedProducts = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredProducts.slice(start, start + itemsPerPage);
  }, [filteredProducts, currentPage, itemsPerPage]);

  // Reset Add Form Helper
  const resetAddForm = () => {
    addFormik.resetForm();
    setAddImageFile(null);
    if (addPreviewUrl && addPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(addPreviewUrl);
    }
    setAddPreviewUrl(null);
    setAddLocation(null);
    setAddLocationError('');
    if (addFileInputRef.current) addFileInputRef.current.value = '';
    setIsAddModalOpen(false);
  };

  // Close Edit Modal and reset state
  const closeEditModal = () => {
    setEditingProduct(null);
    editFormik.resetForm();
    setEditImageFile(null);
    if (editPreviewUrl && editPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(editPreviewUrl);
    }
    setEditPreviewUrl(null);
    setEditLocation(null);
    setEditLocationError('');
    if (editFileInputRef.current) {
      editFileInputRef.current.value = '';
    }
  };

  // Formik for Add Product
  const addFormik = useFormik({
    initialValues: {
      title: '',
      description: '',
      price: '',
      quantity: '0',
      category: 'Electronics',
      status: 'active',
    },
    validationSchema: productValidationSchema,
    onSubmit: async (values, { setSubmitting }) => {
      try {
        const formData = new FormData();
        formData.append('title', values.title.trim());
        formData.append('description', (values.description || '').trim());
        formData.append('price', Number(values.price));
        formData.append('quantity', Number(values.quantity));
        formData.append('category', (values.category || 'General').trim());
        formData.append('status', values.status);

        if (addLocation && addLocation.lat !== undefined && addLocation.lng !== undefined) {
          formData.append('latitude', Number(addLocation.lat));
          formData.append('longitude', Number(addLocation.lng));
          if (addLocation.displayName || addLocation.name) {
            formData.append('locationName', addLocation.displayName || addLocation.name);
          }
        }

        if (addImageFile) {
          formData.append('image', addImageFile);
        }

        const res = await fetch('/api/products', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.message || 'Failed to create product');
        }

        triggerToast('Product created successfully!', 'success');
        resetAddForm();
        fetchProducts();
      } catch (err) {
        const errorMsg = err.message || 'Error creating product';
        if (
          errorMsg.toLowerCase().includes('latitude') ||
          errorMsg.toLowerCase().includes('longitude') ||
          errorMsg.toLowerCase().includes('location')
        ) {
          setAddLocationError(errorMsg);
        }
        triggerToast(errorMsg, 'error');
      } finally {
        setSubmitting(false);
      }
    },
  });

  // Formik for Edit Product
  const editFormik = useFormik({
    initialValues: {
      title: '',
      description: '',
      price: '',
      quantity: '0',
      category: 'General',
      status: 'active',
    },
    enableReinitialize: true,
    validationSchema: productValidationSchema,
    onSubmit: async (values, { setSubmitting }) => {
      if (!editingProduct) return;
      try {
        const formData = new FormData();
        formData.append('title', values.title.trim());
        formData.append('description', (values.description || '').trim());
        formData.append('price', Number(values.price));
        formData.append('quantity', Number(values.quantity));
        formData.append('category', (values.category || 'General').trim());
        formData.append('status', values.status);

        if (editLocation && editLocation.lat !== undefined && editLocation.lng !== undefined) {
          formData.append('latitude', Number(editLocation.lat));
          formData.append('longitude', Number(editLocation.lng));
          if (editLocation.displayName || editLocation.name) {
            formData.append('locationName', editLocation.displayName || editLocation.name);
          }
        }

        if (editImageFile) {
          formData.append('image', editImageFile);
        }

        const res = await fetch(`/api/products/${editingProduct._id}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.message || 'Failed to update product');
        }

        triggerToast('Product updated successfully!', 'success');
        closeEditModal();
        fetchProducts();
      } catch (err) {
        const errorMsg = err.message || 'Error updating product';
        if (
          errorMsg.toLowerCase().includes('latitude') ||
          errorMsg.toLowerCase().includes('longitude') ||
          errorMsg.toLowerCase().includes('location')
        ) {
          setEditLocationError(errorMsg);
        }
        triggerToast(errorMsg, 'error');
      } finally {
        setSubmitting(false);
      }
    },
  });

  // Handle Image File Selection for Add Modal
  const handleAddImageChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type.toLowerCase())) {
      triggerToast('Please select a valid image file (jpg, jpeg, png, webp)', 'error');
      return;
    }

    // Validate 5MB file size
    if (file.size > 5 * 1024 * 1024) {
      triggerToast('Image file size must be less than 5MB', 'error');
      return;
    }

    setAddImageFile(file);
    setAddPreviewUrl(URL.createObjectURL(file));
  };

  // Discard newly chosen replacement image and keep current stored image
  const handleDiscardNewImage = () => {
    setEditImageFile(null);
    if (editPreviewUrl && editPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(editPreviewUrl);
    }
    setEditPreviewUrl(null);
    if (editFileInputRef.current) {
      editFileInputRef.current.value = '';
    }
  };

  // Open Edit Modal: load product and display existing values
  const openEditModal = async (product) => {
    if (!product) return;

    // 1. Immediately prefill from selected product
    setEditingProduct(product);
    setEditLocation(extractProductLocation(product.location));
    setEditLocationError('');
    editFormik.setValues({
      title: product.title || '',
      description: product.description || '',
      price: product.price !== undefined ? String(product.price) : '0',
      quantity: product.quantity !== undefined ? String(product.quantity) : '0',
      category: product.category || 'General',
      status: product.status || 'active',
    });
    setEditImageFile(null);
    setEditPreviewUrl(null);
    if (editFileInputRef.current) {
      editFileInputRef.current.value = '';
    }

    // 2. Fetch latest product details from existing Products API (GET /api/products/:id)
    if (token && product._id) {
      try {
        setLoadingEditProduct(true);
        const res = await fetch(`/api/products/${product._id}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const data = await res.json();
        if (res.ok && data.success && data.data) {
          const fresh = data.data;
          setEditingProduct(fresh);
          setEditLocation(extractProductLocation(fresh.location));
          editFormik.setValues({
            title: fresh.title || '',
            description: fresh.description || '',
            price: fresh.price !== undefined ? String(fresh.price) : '0',
            quantity: fresh.quantity !== undefined ? String(fresh.quantity) : '0',
            category: fresh.category || 'General',
            status: fresh.status || 'active',
          });
        }
      } catch (err) {
        console.warn('Could not refresh product details from API, using row data:', err);
      } finally {
        setLoadingEditProduct(false);
      }
    }
  };

  // Handle Edit Image File Selection with validation
  const handleEditImageChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type.toLowerCase())) {
      triggerToast('Please select a valid image file (jpg, jpeg, png, webp)', 'error');
      if (editFileInputRef.current) editFileInputRef.current.value = '';
      return;
    }

    // Validate 5MB file size
    if (file.size > 5 * 1024 * 1024) {
      triggerToast('Image file size must be less than 5MB', 'error');
      if (editFileInputRef.current) editFileInputRef.current.value = '';
      return;
    }

    setEditImageFile(file);
    if (editPreviewUrl && editPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(editPreviewUrl);
    }
    setEditPreviewUrl(URL.createObjectURL(file));
  };

  // Open View Modal and fetch fresh product data using GET /api/products/:id
  const openViewModal = async (product) => {
    const id = typeof product === 'object' && product ? product._id : product;
    if (!id) return;

    setViewingProductId(id);
    // Use clicked row object as initial data if available for immediate responsiveness
    setViewingProduct(typeof product === 'object' ? product : null);
    setViewLoading(true);
    setViewError(null);

    try {
      const res = await fetch(`/api/products/${id}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to load product details');
      }

      if (data.success && data.data) {
        setViewingProduct(data.data);
      } else {
        throw new Error('Product not found or invalid response structure');
      }
    } catch (err) {
      setViewError(err.message || 'Error loading product details');
    } finally {
      setViewLoading(false);
    }
  };

  // Close View Modal and reset state
  const closeViewModal = () => {
    setViewingProductId(null);
    setViewingProduct(null);
    setViewLoading(false);
    setViewError(null);
  };

  // Handle Delete Product
  const handleDeleteProduct = async () => {
    if (!deletingProduct) return;
    setIsDeleting(true);
    const targetId = deletingProduct._id;
    const targetTitle = deletingProduct.title || 'Product';

    try {
      const res = await fetch(`/api/products/${targetId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json();

      // Handle product-not-found cases (404)
      if (res.status === 404) {
        triggerToast(
          data.message || `Product "${targetTitle}" was not found (it may have already been deleted).`,
          'error'
        );
        // Remove from local list anyway
        setProducts((prev) => {
          const updated = prev.filter((p) => p._id !== targetId);
          if (onCountChange) onCountChange(updated.length);
          return updated;
        });
        setDeletingProduct(null);
        return;
      }

      // Handle other API errors
      if (!res.ok) {
        throw new Error(data.message || 'Failed to delete product');
      }

      // Remove product from the list immediately
      setProducts((prev) => {
        const updated = prev.filter((p) => p._id !== targetId);
        if (onCountChange) onCountChange(updated.length);
        return updated;
      });

      // Show success toast
      triggerToast(`Product "${targetTitle}" deleted successfully!`, 'success');

      // Close confirmation dialog
      setDeletingProduct(null);

      // Refresh list to keep pagination consistent
      fetchProducts();
    } catch (err) {
      triggerToast(err.message || 'Error deleting product', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      {/* Header & Controls Toolbar */}
      <div className={styles.moduleHeader}>
        <div className={styles.moduleTitleSection}>
          <h2 className={styles.moduleTitle}>Products Catalog & Inventory</h2>
          <span className={styles.countPill}>{filteredProducts.length}</span>
        </div>
        <div className={styles.toolbar}>
          {/* Search Box */}
          <input
            type="text"
            placeholder="Search by title or description..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={styles.searchInput}
          />

          {/* Category Filter */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className={styles.selectFilter}
          >
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat === 'ALL' ? 'All Categories' : cat}
              </option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={styles.selectFilter}
          >
            <option value="ALL">All Status</option>
            <option value="active">Active Only</option>
            <option value="inactive">Inactive Only</option>
          </select>

          {/* Refresh Button */}
          <button
            type="button"
            onClick={() => fetchProducts(true)}
            disabled={refreshing}
            className={styles.secondaryBtn}
            title="Refresh product list"
          >
            {refreshing ? 'Refreshing...' : '↻ Refresh'}
          </button>

          {/* Add Product Button */}
          <button
            type="button"
            onClick={() => setIsAddModalOpen(true)}
            className={styles.primaryBtn}
          >
            + Add Product
          </button>
        </div>
      </div>

      {/* Products Data Table */}
      <div className={styles.tableContainer}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th style={{ width: '60px' }}>Image</th>
              <th>Title</th>
              <th>Category</th>
              <th>Price (₹)</th>
              <th>Quantity</th>
              <th>Status</th>
              <th>Location</th>
              <th>Created Date</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
                  Loading products...
                </td>
              </tr>
            ) : paginatedProducts.length === 0 ? (
              <tr>
                <td colSpan={9}>
                  <div className={styles.emptyState}>
                    <div className={styles.emptyTitle}>No products found</div>
                    <div className={styles.emptyDesc}>
                      {searchQuery || categoryFilter !== 'ALL' || statusFilter !== 'ALL'
                        ? 'Try adjusting your search criteria or filter options.'
                        : 'Get started by clicking "+ Add Product" above.'}
                    </div>
                  </div>
                </td>
              </tr>
            ) : (
              paginatedProducts.map((p) => {
                const createdDate = p.createdAt
                  ? new Date(p.createdAt).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })
                  : 'N/A';

                const isOutOfStock = p.quantity <= 0;
                const isLowStock = p.quantity > 0 && p.quantity <= 5;

                return (
                  <tr key={p._id}>
                    {/* 1. Image */}
                    <td>
                      {p.image ? (
                        <img
                          src={p.image}
                          alt={p.title}
                          className={styles.productThumb}
                          onClick={() => openViewModal(p)}
                          style={{ cursor: 'pointer' }}
                          title="Click to view image"
                          onError={(e) => {
                            e.target.onerror = null;
                            e.target.src = 'https://placehold.co/100x100?text=No+Image';
                          }}
                        />
                      ) : (
                        <div
                          className={styles.productThumbPlaceholder}
                          onClick={() => openViewModal(p)}
                          style={{ cursor: 'pointer' }}
                          title="Click to view image"
                        >
                          📦
                        </div>
                      )}
                    </td>

                    {/* 2. Title */}
                    <td>
                      <div className={styles.productTitleCell}>{p.title}</div>
                      {p.description && (
                        <div className={styles.productDescSnippet}>{p.description}</div>
                      )}
                    </td>


                    {/* 4. Category */}
                    <td>
                      <span className={styles.categoryBadge}>{p.category || 'General'}</span>
                    </td>

                    {/* 5. Price */}
                    <td>
                      <span className={styles.priceTag}>
                        ₹{Number(p.price || 0).toFixed(2)}
                      </span>
                    </td>

                    {/* 6. Quantity */}
                    <td>
                      <span
                        className={`${styles.stockBadge} ${isOutOfStock
                          ? styles.stockOut
                          : isLowStock
                            ? styles.stockLow
                            : styles.stockIn
                          }`}
                      >
                        {p.quantity} {isOutOfStock ? '(Out)' : isLowStock ? '(Low)' : 'in stock'}
                      </span>
                    </td>

                    {/* 7. Status */}
                    <td>
                      <span
                        className={
                          p.status === 'active' ? styles.statusActive : styles.statusInactive
                        }
                      >
                        {p.status === 'active' ? 'Active' : 'Inactive'}
                      </span>
                    </td>

                    {/* 8. Location */}
                    <td>
                      {p.location && p.location.coordinates && p.location.coordinates.length === 2 ? (
                        <div style={{ fontSize: '12px', lineHeight: 1.4 }}>
                          <div
                            style={{
                              display: 'inline-flex',
                              flexDirection: 'column',
                              background: '#ecfdf5',
                              color: '#065f46',
                              border: '1px solid #a7f3d0',
                              borderRadius: '7px',
                              padding: '5px 9px',
                              fontSize: '11.5px',
                              fontWeight: 600,
                              maxWidth: '220px',
                              boxShadow: '0 1px 2px rgba(16, 185, 129, 0.08)',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '4px', color: '#047857', fontWeight: 700 }}>
                              <span style={{ fontSize: '12px', lineHeight: 1.2, marginTop: '1px' }}>📍</span>
                              <span style={{ wordBreak: 'break-word', whiteSpace: 'normal', lineHeight: 1.3 }}>
                                {p.location.name || p.location.address || 'Selected Location'}
                              </span>
                            </div>
                            <div style={{ fontSize: '10.5px', color: '#059669', fontFamily: 'monospace', marginTop: '3px', fontWeight: 500, paddingLeft: '16px' }}>
                              {Number(p.location.coordinates[1]).toFixed(4)}, {Number(p.location.coordinates[0]).toFixed(4)}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <span
                          style={{
                            display: 'inline-block',
                            background: '#fef2f2',
                            color: '#991b1b',
                            border: '1px solid #fecaca',
                            borderRadius: '6px',
                            padding: '3px 8px',
                            fontSize: '11.5px',
                            fontWeight: 600,
                          }}
                        >
                          No Location
                        </span>
                      )}
                    </td>

                    {/* 9. Created Date */}
                    <td style={{ color: '#64748b', fontSize: '13px' }}>{createdDate}</td>

                    {/* 9. Actions (View, Edit, Delete) */}
                    <td style={{ textAlign: 'right' }}>
                      <div className={styles.actionButtonGroup}>
                        <button
                          type="button"
                          onClick={() => openViewModal(p)}
                          className={styles.btnView}
                          title="View product details"
                        >
                          View
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditModal(p)}
                          className={styles.btnEdit}
                          title="Edit product"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingProduct(p)}
                          className={styles.btnDelete}
                          title="Delete product"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Bar */}
      {!loading && filteredProducts.length > 0 && (
        <div className={styles.paginationContainer}>
          <div className={styles.paginationInfo}>
            Showing{' '}
            <strong>
              {(currentPage - 1) * itemsPerPage + 1} -{' '}
              {Math.min(currentPage * itemsPerPage, filteredProducts.length)}
            </strong>{' '}
            of <strong>{filteredProducts.length}</strong> products
          </div>
          <div className={styles.paginationControls}>
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className={styles.pageBtn}
            >
              ‹ Prev
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((pg) => (
              <button
                key={pg}
                type="button"
                onClick={() => setCurrentPage(pg)}
                className={`${styles.pageBtn} ${currentPage === pg ? styles.pageBtnActive : ''}`}
              >
                {pg}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className={styles.pageBtn}
            >
              Next ›
            </button>
          </div>
        </div>
      )}

      {/* ========================================================
          1. ADD PRODUCT MODAL (COMPLETE WITH ALL 8 FIELDS)
         ======================================================== */}
      {isAddModalOpen && (
        <div className={styles.modalOverlay} onClick={resetAddForm}>
          <div
            className={styles.modalContent}
            style={{ maxWidth: '620px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>+ Add New Product</h3>
              <button
                type="button"
                className={styles.modalClose}
                onClick={resetAddForm}
              >
                ×
              </button>
            </div>
            <form
              onSubmit={addFormik.handleSubmit}
              style={{
                display: 'flex',
                flexDirection: 'column',
                flex: 1,
                minHeight: 0,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  padding: '20px 24px',
                  overflowY: 'auto',
                  flex: 1,
                  minHeight: 0,
                }}
              >
                {/* 1. Product Image Selection */}
                <div className={styles.formGroup}>
                  <label className={styles.label}>Product Image</label>
                  <label className={styles.imageUploadBox}>
                    <input
                      ref={addFileInputRef}
                      type="file"
                      accept=".jpg,.jpeg,.png,.webp"
                      style={{ display: 'none' }}
                      onChange={handleAddImageChange}
                    />
                    <div style={{ fontSize: '13.5px', fontWeight: 600, color: '#2563eb' }}>
                      {addImageFile ? `✓ Selected: ${addImageFile.name}` : '📁 Click to choose an image file (jpg, png, webp < 5MB)'}
                    </div>
                  </label>
                  {addPreviewUrl && (
                    <div style={{ position: 'relative', marginTop: '10px' }}>
                      <img src={addPreviewUrl} alt="Preview" className={styles.imagePreview} />
                      <button
                        type="button"
                        onClick={() => {
                          setAddImageFile(null);
                          if (addPreviewUrl && addPreviewUrl.startsWith('blob:')) {
                            URL.revokeObjectURL(addPreviewUrl);
                          }
                          setAddPreviewUrl(null);
                          if (addFileInputRef.current) addFileInputRef.current.value = '';
                        }}
                        style={{
                          position: 'absolute',
                          top: '8px',
                          right: '8px',
                          background: 'rgba(239, 68, 68, 0.9)',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: '6px',
                          padding: '4px 10px',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Remove Image
                      </button>
                    </div>
                  )}
                </div>

                {/* 2. Title */}
                <div className={styles.formGroup}>
                  <label className={styles.label}>Title *</label>
                  <input
                    type="text"
                    name="title"
                    placeholder="Enter Title"
                    value={addFormik.values.title}
                    onChange={addFormik.handleChange}
                    onBlur={addFormik.handleBlur}
                    className={styles.modalInput}
                    style={addFormik.touched.title && addFormik.errors.title ? { borderColor: '#dc2626' } : {}}
                  />
                  {addFormik.touched.title && addFormik.errors.title && (
                    <div style={{ color: '#dc2626', fontSize: '12px', marginTop: '4px', fontWeight: 500 }}>
                      {addFormik.errors.title}
                    </div>
                  )}
                </div>

                {/* 3. Description */}
                <div className={styles.formGroup}>
                  <label className={styles.label}>Description *</label>
                  <textarea
                    rows={3}
                    name="description"
                    placeholder="Enter Description"
                    value={addFormik.values.description}
                    onChange={addFormik.handleChange}
                    onBlur={addFormik.handleBlur}
                    className={styles.modalInput}
                    style={{
                      resize: 'vertical',
                      ...(addFormik.touched.description && addFormik.errors.description ? { borderColor: '#dc2626' } : {}),
                    }}
                  />
                  {addFormik.touched.description && addFormik.errors.description && (
                    <div style={{ color: '#dc2626', fontSize: '12px', marginTop: '4px', fontWeight: 500 }}>
                      {addFormik.errors.description}
                    </div>
                  )}
                </div>

                {/* 4 & 5. Price and Quantity */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div className={styles.formGroup}>
                    <label className={styles.label}>Price (₹) *</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      name="price"
                      placeholder="0.00"
                      value={addFormik.values.price}
                      onChange={addFormik.handleChange}
                      onBlur={addFormik.handleBlur}
                      className={styles.modalInput}
                      style={addFormik.touched.price && addFormik.errors.price ? { borderColor: '#dc2626' } : {}}
                    />
                    {addFormik.touched.price && addFormik.errors.price && (
                      <div style={{ color: '#dc2626', fontSize: '12px', marginTop: '4px', fontWeight: 500 }}>
                        {addFormik.errors.price}
                      </div>
                    )}
                  </div>
                  <div className={styles.formGroup}>
                    <label className={styles.label}>Quantity *</label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      name="quantity"
                      placeholder="0"
                      value={addFormik.values.quantity}
                      onChange={addFormik.handleChange}
                      onBlur={addFormik.handleBlur}
                      className={styles.modalInput}
                      style={addFormik.touched.quantity && addFormik.errors.quantity ? { borderColor: '#dc2626' } : {}}
                    />
                    {addFormik.touched.quantity && addFormik.errors.quantity && (
                      <div style={{ color: '#dc2626', fontSize: '12px', marginTop: '4px', fontWeight: 500 }}>
                        {addFormik.errors.quantity}
                      </div>
                    )}
                  </div>
                </div>

                {/* 6 & 7. Category and Status */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                  <div className={styles.formGroup}>
                    <label className={styles.label}>Category</label>
                    <input
                      type="text"
                      name="category"
                      placeholder="e.g. Electronics"
                      value={addFormik.values.category}
                      onChange={addFormik.handleChange}
                      onBlur={addFormik.handleBlur}
                      className={styles.modalInput}
                      style={addFormik.touched.category && addFormik.errors.category ? { borderColor: '#dc2626' } : {}}
                    />
                    {addFormik.touched.category && addFormik.errors.category && (
                      <div style={{ color: '#dc2626', fontSize: '12px', marginTop: '4px', fontWeight: 500 }}>
                        {addFormik.errors.category}
                      </div>
                    )}
                  </div>
                  <div className={styles.formGroup}>
                    <label className={styles.label}>Status</label>
                    <select
                      name="status"
                      value={addFormik.values.status}
                      onChange={addFormik.handleChange}
                      onBlur={addFormik.handleBlur}
                      className={styles.modalSelect}
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </div>
                </div>

                {/* 8. Product Location Section with LocationPicker */}
                <div className={styles.formGroup} style={{ marginTop: '16px' }}>
                  <label className={styles.label}>
                    Product Location (Search area/landmark or click on map)
                  </label>
                  <div style={{ marginTop: '6px' }}>
                    <LocationPicker
                      value={addLocation}
                      onChange={handleAddLocationChange}
                      height="260px"
                    />
                  </div>
                  {addLocationError && (
                    <div style={{ color: '#dc2626', fontSize: '12px', marginTop: '6px', fontWeight: 500 }}>
                      {addLocationError}
                    </div>
                  )}
                </div>
              </div>

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  onClick={resetAddForm}
                  className={styles.cancelBtn}
                  disabled={addFormik.isSubmitting}
                >
                  Cancel
                </button>
                <button type="submit" className={styles.submitBtn} disabled={addFormik.isSubmitting}>
                  {addFormik.isSubmitting ? 'Creating Product...' : '+ Create Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================
          2. EDIT PRODUCT MODAL
         ======================================================== */}
      {editingProduct && (
        <div
          className={styles.modalOverlay}
          onClick={() => {
            if (!editFormik.isSubmitting) closeEditModal();
          }}
        >
          <div
            className={styles.modalContent}
            style={{ maxWidth: '640px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <div>
                <h3 className={styles.modalTitle}>Edit Product</h3>
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '3px' }}>
                  Product ID:{' '}
                  <span style={{ fontFamily: 'monospace', color: '#0f172a', fontWeight: 600 }}>
                    {editingProduct._id}
                  </span>
                  {loadingEditProduct && (
                    <span style={{ marginLeft: '10px', color: '#2563eb', fontWeight: 600 }}>
                      ⚡ Syncing latest data...
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                className={styles.modalClose}
                onClick={closeEditModal}
                disabled={editFormik.isSubmitting}
              >
                ×
              </button>
            </div>

            <form
              onSubmit={editFormik.handleSubmit}
              style={{
                display: 'flex',
                flexDirection: 'column',
                flex: 1,
                minHeight: 0,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  padding: '20px 24px',
                  overflowY: 'auto',
                  flex: 1,
                  minHeight: 0,
                }}
              >
                {/* 1. Product Title */}
                <div className={styles.formGroup}>
                  <label className={styles.label}>Product Title *</label>
                  <input
                    type="text"
                    name="title"
                    disabled={editFormik.isSubmitting}
                    value={editFormik.values.title}
                    onChange={editFormik.handleChange}
                    onBlur={editFormik.handleBlur}
                    className={styles.modalInput}
                    placeholder="Enter Title"
                    style={editFormik.touched.title && editFormik.errors.title ? { borderColor: '#dc2626' } : {}}
                  />
                  {editFormik.touched.title && editFormik.errors.title && (
                    <div style={{ color: '#dc2626', fontSize: '12px', marginTop: '4px', fontWeight: 500 }}>
                      {editFormik.errors.title}
                    </div>
                  )}
                </div>

                {/* 2. Description */}
                <div className={styles.formGroup}>
                  <label className={styles.label}>Description *</label>
                  <textarea
                    rows={3}
                    name="description"
                    disabled={editFormik.isSubmitting}
                    value={editFormik.values.description}
                    onChange={editFormik.handleChange}
                    onBlur={editFormik.handleBlur}
                    className={styles.modalInput}
                    placeholder="enter description"
                    style={{
                      resize: 'vertical',
                      ...(editFormik.touched.description && editFormik.errors.description ? { borderColor: '#dc2626' } : {}),
                    }}
                  />
                  {editFormik.touched.description && editFormik.errors.description && (
                    <div style={{ color: '#dc2626', fontSize: '12px', marginTop: '4px', fontWeight: 500 }}>
                      {editFormik.errors.description}
                    </div>
                  )}
                </div>

                {/* 3. Price & Quantity */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div className={styles.formGroup}>
                    <label className={styles.label}>Price (₹) *</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      name="price"
                      disabled={editFormik.isSubmitting}
                      value={editFormik.values.price}
                      onChange={editFormik.handleChange}
                      onBlur={editFormik.handleBlur}
                      className={styles.modalInput}
                      placeholder="0.00"
                      style={editFormik.touched.price && editFormik.errors.price ? { borderColor: '#dc2626' } : {}}
                    />
                    {editFormik.touched.price && editFormik.errors.price && (
                      <div style={{ color: '#dc2626', fontSize: '12px', marginTop: '4px', fontWeight: 500 }}>
                        {editFormik.errors.price}
                      </div>
                    )}
                  </div>
                  <div className={styles.formGroup}>
                    <label className={styles.label}>Quantity *</label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      name="quantity"
                      disabled={editFormik.isSubmitting}
                      value={editFormik.values.quantity}
                      onChange={editFormik.handleChange}
                      onBlur={editFormik.handleBlur}
                      className={styles.modalInput}
                      placeholder="0"
                      style={editFormik.touched.quantity && editFormik.errors.quantity ? { borderColor: '#dc2626' } : {}}
                    />
                    {editFormik.touched.quantity && editFormik.errors.quantity && (
                      <div style={{ color: '#dc2626', fontSize: '12px', marginTop: '4px', fontWeight: 500 }}>
                        {editFormik.errors.quantity}
                      </div>
                    )}
                  </div>
                </div>

                {/* 4. Category & Status */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '14px',
                  }}
                >
                  <div className={styles.formGroup}>
                    <label className={styles.label}>Category</label>
                    <input
                      type="text"
                      name="category"
                      disabled={editFormik.isSubmitting}
                      value={editFormik.values.category}
                      onChange={editFormik.handleChange}
                      onBlur={editFormik.handleBlur}
                      className={styles.modalInput}
                      placeholder="e.g. Electronics"
                      style={editFormik.touched.category && editFormik.errors.category ? { borderColor: '#dc2626' } : {}}
                    />
                    {editFormik.touched.category && editFormik.errors.category && (
                      <div style={{ color: '#dc2626', fontSize: '12px', marginTop: '4px', fontWeight: 500 }}>
                        {editFormik.errors.category}
                      </div>
                    )}
                  </div>
                  <div className={styles.formGroup}>
                    <label className={styles.label}>Status</label>
                    <select
                      name="status"
                      disabled={editFormik.isSubmitting}
                      value={editFormik.values.status}
                      onChange={editFormik.handleChange}
                      onBlur={editFormik.handleBlur}
                      className={styles.modalSelect}
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </div>
                </div>

                {/* 5. Product Image Section: Current Image & Replacement Upload */}
                <div className={styles.formGroup}>
                  <label className={styles.label}>Product Image</label>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: editingProduct.image ? '160px 1fr' : '1fr',
                      gap: '16px',
                      alignItems: 'start',
                    }}
                  >
                    {/* Display Current Stored Image */}
                    {editingProduct.image && (
                      <div
                        style={{
                          background: '#f8fafc',
                          border: '1px solid #e2e8f0',
                          borderRadius: '10px',
                          padding: '10px',
                          textAlign: 'center',
                        }}
                      >
                        <div
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            color: '#64748b',
                            textTransform: 'uppercase',
                            letterSpacing: '0.04em',
                            marginBottom: '6px',
                          }}
                        >
                          Current Image
                        </div>
                        <img
                          src={editingProduct.image}
                          alt={editingProduct.title || 'Product'}
                          style={{
                            width: '100%',
                            height: '110px',
                            objectFit: 'cover',
                            borderRadius: '6px',
                            border: '1px solid #cbd5e1',
                          }}
                          onError={(e) => {
                            e.target.onerror = null;
                            e.target.src = 'https://placehold.co/150x110?text=No+Image';
                          }}
                        />
                      </div>
                    )}

                    {/* Choose Replacement Image */}
                    <div>
                      <label
                        className={styles.imageUploadBox}
                        style={{
                          minHeight: editingProduct.image ? '136px' : 'auto',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: editFormik.isSubmitting ? 'not-allowed' : 'pointer',
                        }}
                      >
                        <input
                          ref={editFileInputRef}
                          type="file"
                          accept=".jpg,.jpeg,.png,.webp"
                          disabled={editFormik.isSubmitting}
                          style={{ display: 'none' }}
                          onChange={handleEditImageChange}
                        />
                        <div style={{ fontSize: '26px', marginBottom: '4px' }}>📁</div>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: '#2563eb' }}>
                          {editImageFile
                            ? `Selected: ${editImageFile.name}`
                            : editingProduct.image
                              ? 'Click to choose replacement image'
                              : 'Click to upload an image'}
                        </div>
                        <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '3px' }}>
                          JPG, PNG, WEBP up to 5MB
                        </div>
                      </label>

                      {/* New Replacement Image Preview with Discard Option */}
                      {editPreviewUrl && (
                        <div
                          style={{
                            marginTop: '10px',
                            background: '#ecfdf5',
                            border: '1px solid #a7f3d0',
                            borderRadius: '8px',
                            padding: '8px 12px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '12px',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '10px',
                              overflow: 'hidden',
                            }}
                          >
                            <img
                              src={editPreviewUrl}
                              alt="New replacement preview"
                              style={{
                                width: '42px',
                                height: '42px',
                                objectFit: 'cover',
                                borderRadius: '6px',
                                border: '1px solid #6ee7b7',
                                flexShrink: 0,
                              }}
                            />
                            <div style={{ overflow: 'hidden' }}>
                              <div
                                style={{
                                  fontSize: '12px',
                                  fontWeight: 700,
                                  color: '#065f46',
                                }}
                              >
                                New image will replace current
                              </div>
                              <div
                                style={{
                                  fontSize: '11px',
                                  color: '#047857',
                                  whiteSpace: 'nowrap',
                                  textOverflow: 'ellipsis',
                                  overflow: 'hidden',
                                }}
                              >
                                {editImageFile?.name} (
                                {((editImageFile?.size || 0) / 1024).toFixed(0)} KB)
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={handleDiscardNewImage}
                            disabled={editFormik.isSubmitting}
                            style={{
                              background: '#fee2e2',
                              color: '#b91c1c',
                              border: 'none',
                              borderRadius: '6px',
                              padding: '5px 10px',
                              fontSize: '11.5px',
                              fontWeight: 600,
                              cursor: 'pointer',
                              flexShrink: 0,
                            }}
                            title="Cancel new image and keep current"
                          >
                            ✕ Discard New
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* 6. Product Location Section with LocationPicker */}
                <div className={styles.formGroup} style={{ marginTop: '16px' }}>
                  <label className={styles.label}>
                    Product Location (Search area/landmark or click on map to update coordinates)
                  </label>
                  <div style={{ marginTop: '6px' }}>
                    <LocationPicker
                      value={editLocation}
                      onChange={handleEditLocationChange}
                      height="260px"
                    />
                  </div>
                  {editLocationError && (
                    <div style={{ color: '#dc2626', fontSize: '12px', marginTop: '6px', fontWeight: 500 }}>
                      {editLocationError}
                    </div>
                  )}
                </div>
              </div>

              {/* Modal Actions */}
              <div className={styles.modalFooter}>
                <button
                  type="button"
                  onClick={closeEditModal}
                  className={styles.cancelBtn}
                  disabled={editFormik.isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={styles.submitBtn}
                  disabled={editFormik.isSubmitting}
                >
                  {editFormik.isSubmitting ? 'Updating Product...' : 'Update Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================
          3. VIEW IMAGE MODAL (IMAGE ONLY)
         ======================================================== */}
      {(viewingProductId || viewingProduct) && (
        <div className={styles.modalOverlay} onClick={closeViewModal}>
          <div
            className={styles.modalContent}
            style={{ maxWidth: '680px', width: '92%' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Product Image</h3>
              <button
                type="button"
                className={styles.modalClose}
                onClick={closeViewModal}
              >
                ×
              </button>
            </div>

            <div style={{ padding: '20px 24px', maxHeight: '76vh', overflowY: 'auto' }}>
              {/* Loading state */}
              {viewLoading && !viewingProduct ? (
                <div className={styles.detailLoadingCard}>
                  <div className={styles.detailSpinner}></div>
                  <div style={{ fontSize: '15px', fontWeight: 600, color: '#0f172a' }}>
                    Loading Image...
                  </div>
                </div>
              ) : viewError && !viewingProduct ? (
                /* Error state */
                <div className={styles.detailErrorCard}>
                  <div style={{ fontSize: '32px' }}>⚠️</div>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: '#991b1b' }}>
                    Failed to load product image
                  </div>
                  <div style={{ fontSize: '13px', color: '#b91c1c' }}>{viewError}</div>
                  <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                    <button
                      type="button"
                      onClick={() => openViewModal(viewingProductId)}
                      className={styles.submitBtn}
                      style={{ padding: '7px 16px', fontSize: '13px' }}
                    >
                      Retry
                    </button>
                    <button
                      type="button"
                      onClick={closeViewModal}
                      className={styles.cancelBtn}
                      style={{ padding: '7px 16px', fontSize: '13px' }}
                    >
                      Close
                    </button>
                  </div>
                </div>
              ) : viewingProduct ? (
                /* Image Only display */
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: '260px',
                    padding: '8px 0',
                  }}
                >
                  {viewingProduct.image ? (
                    <img
                      src={viewingProduct.image}
                      alt={viewingProduct.title || 'Product Image'}
                      style={{
                        maxWidth: '100%',
                        maxHeight: '68vh',
                        objectFit: 'contain',
                        borderRadius: '10px',
                        boxShadow: '0 8px 30px rgba(0, 0, 0, 0.12)',
                        display: 'block',
                        margin: '0 auto',
                      }}
                      onError={(e) => {
                        e.target.onerror = null;
                        e.target.src = 'https://placehold.co/600x400?text=No+Image';
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        padding: '48px 24px',
                        textAlign: 'center',
                        color: '#64748b',
                        background: '#f8fafc',
                        borderRadius: '12px',
                        width: '100%',
                        border: '1px dashed #cbd5e1',
                      }}
                    >
                      <div style={{ fontSize: '48px', marginBottom: '8px' }}>🖼️</div>
                      <div style={{ fontSize: '15px', fontWeight: 600, color: '#334155' }}>
                        No Image Uploaded
                      </div>
                      <div style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>
                        This product does not have an image yet.
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            <div className={styles.modalFooter}>
              <button
                type="button"
                onClick={closeViewModal}
                className={styles.cancelBtn}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          4. DELETE CONFIRMATION MODAL
         ======================================================== */}
      {deletingProduct && (
        <div
          className={styles.modalOverlay}
          onClick={() => {
            if (!isDeleting) setDeletingProduct(null);
          }}
        >
          <div
            className={styles.modalContent}
            style={{ maxWidth: '460px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle} style={{ color: '#dc2626' }}>
                Confirm Delete
              </h3>
              <button
                type="button"
                className={styles.modalClose}
                onClick={() => setDeletingProduct(null)}
                disabled={isDeleting}
              >
                ×
              </button>
            </div>
            <div style={{ padding: '24px 28px' }}>
              <p
                style={{
                  margin: '0 0 14px 0',
                  fontSize: '15px',
                  color: '#0f172a',
                  fontWeight: 600,
                  lineHeight: 1.5,
                }}
              >
                Are you sure you want to delete this product?
              </p>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: '10px',
                  padding: '12px 14px',
                }}
              >
                {deletingProduct.image ? (
                  <img
                    src={deletingProduct.image}
                    alt={deletingProduct.title || 'Product'}
                    style={{
                      width: '48px',
                      height: '48px',
                      objectFit: 'cover',
                      borderRadius: '8px',
                      border: '1px solid #fca5a5',
                      flexShrink: 0,
                    }}
                    onError={(e) => {
                      e.target.onerror = null;
                      e.target.src = 'https://placehold.co/100x100?text=No+Image';
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: '48px',
                      height: '48px',
                      background: '#fee2e2',
                      borderRadius: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '22px',
                      flexShrink: 0,
                    }}
                  >
                    📦
                  </div>
                )}
                <div style={{ overflow: 'hidden' }}>
                  <div
                    style={{
                      fontWeight: 700,
                      color: '#991b1b',
                      fontSize: '14.5px',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {deletingProduct.title}
                  </div>
                  <div style={{ fontSize: '12px', color: '#b91c1c', marginTop: '2px' }}>
                    {deletingProduct.category || 'General'} • $
                    {Number(deletingProduct.price || 0).toFixed(2)}
                  </div>
                </div>
              </div>

              <p
                style={{
                  margin: '14px 0 0 0',
                  fontSize: '12.5px',
                  color: '#64748b',
                  lineHeight: 1.4,
                }}
              >
                This action cannot be undone. The product record and its associated image file on the server will be permanently deleted.
              </p>
            </div>

            <div className={styles.modalFooter}>
              <button
                type="button"
                onClick={() => setDeletingProduct(null)}
                className={styles.cancelBtn}
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteProduct}
                className={styles.deleteBtn}
                style={{ padding: '10px 20px', borderRadius: '10px', fontSize: '14px' }}
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting Product...' : 'Yes, Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
