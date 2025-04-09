using Entities.Components;
using UnityEngine;
using UnityEngine.UI;

namespace Entities.Player
{
    public class HealthUI : MonoBehaviour
    {
        [SerializeField] GameObject heartPrefab;
        [SerializeField] Transform containerObject;

        Health _health;
        
        GameObject[] _healthList;

        int MaxValue => _health.MaxHealth;
        
        int CurrentValue => _health.Value;
        
        public void Initialize(Health health)
        {
            _health = health;
           _healthList = new GameObject[MaxValue];

           ClearContainer();
           InitHeartsObject();

           _health.OnValueChanged.AddListener(UpdateCurrentEnergy);
        }

        void InitHeartsObject()
        {
            for (var i = 0; i < MaxValue; i++)
            {
                _healthList[i] = Instantiate(heartPrefab, containerObject.transform);
            }
        }

        void UpdateCurrentEnergy(int value)
        {
            var arrayLength = _healthList.Length;
            var threshold = value - 1;

            for (var i = 0; i < arrayLength; i++)
            {
                var energy = _healthList[i];
                var sr = energy.GetComponent<Image>();
                var color = sr.color;

                if (i > threshold)
                {
                    color.a = 0.5f;
                }
                else
                {
                    color.a = 1;
                }
                
                sr.color = color;
            }
        }
        
        void ClearContainer()
        {
            foreach (Transform child in containerObject)
            {
                Destroy(child.gameObject);
            }
        }
    }
}
