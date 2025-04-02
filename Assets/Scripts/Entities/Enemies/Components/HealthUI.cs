using Entities.Components;
using TMPro;
using UnityEngine;

namespace Entities.Enemies.Components
{
    [RequireComponent(typeof(BaseEntity))]
    public class HealthUI : MonoBehaviour
    {
        [SerializeField] TMP_Text textPrefab; 
        
        Health _health;
        void Start()
        {
            _health = GetComponent<BaseEntity>().Health;

            _updateUI(_health.Value);
            _health.OnValueChanged.AddListener(_updateUI);
        }

        void OnDestroy()
        {
            _health.OnValueChanged.RemoveListener(_updateUI);
        }

        void _updateUI(int value)
        {
            textPrefab.gameObject.SetActive(value > 0);
            textPrefab.text = value.ToString();
        }
    }
}