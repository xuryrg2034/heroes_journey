using System;
using Entities.Components;
using TMPro;
using UnityEngine;

namespace Entities.Enemies.Components
{
    [RequireComponent(typeof(BaseEntity))]
    public class HealthUI : MonoBehaviour
    {
        [SerializeField] private TMP_Text textPrefab; 
        
        private Health _health;
        private void Start()
        {
            // _health = GetComponent<BaseEntity>().Health;
            //
            // _updateUI(_health.Value);
            // _health.OnValueChanged.AddListener(_updateUI);
        }

        private void OnDestroy()
        {
            // _health.OnValueChanged.RemoveListener(_updateUI);
        }

        private void _updateUI(int value)
        {
            textPrefab.text = value.ToString();
        }
    }
}