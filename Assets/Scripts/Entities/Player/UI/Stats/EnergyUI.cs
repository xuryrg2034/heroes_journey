using Entities.Components;
using UnityEngine;
using UnityEngine.UI;

namespace Entities.Player
{
    public class EnergyUI : MonoBehaviour
    {
        [SerializeField] GameObject energyPrefab;
        [SerializeField] Transform containerObject;

        Energy _energy;

        string _reservedAnimation = "Reserved";
        
        GameObject[] _energyList;

        int MaxValue => _energy.MaxEnergy;
        
        int CurrentValue => _energy.Value;
        
        int Reserved => _energy.Reserved;
        public void Initialize(Energy energy)
        {
           _energy = energy;
           _energyList = new GameObject[MaxValue];
           

           ClearContainer();
           InitEnergiesObject();

           _energy.OnReservedChanged.AddListener(UpdateReserved);
           _energy.OnValueChanged.AddListener(UpdateCurrentEnergy);
        }

        void InitEnergiesObject()
        {
            for (var i = 0; i < MaxValue; i++)
            {
                _energyList[i] = Instantiate(energyPrefab, containerObject.transform);
            }
        }
        
        void UpdateReserved(int value)
        {
            if (value <= 0) return;
            
            var activeEnergy = CurrentValue;
            var threshold = Mathf.Max(0, activeEnergy - value);

            for (var i = 0; i < activeEnergy; i++)
            {
                var animator = _energyList[i].GetComponent<Animator>();

                // Резервирование энергии
                if (i >= threshold)
                {
                    animator.SetBool(_reservedAnimation, true);
                }
                // Освобождение от резервирования энергии
                else
                {
                    animator.SetBool(_reservedAnimation, false);
                }
            }
        }

        void UpdateCurrentEnergy(int value)
        {
            var arrayLength = _energyList.Length;
            var threshold = value - 1;

            for (var i = 0; i < arrayLength; i++)
            {
                var energy = _energyList[i];
                var sr = energy.GetComponent<Image>();
                var animator = energy.GetComponent<Animator>();
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
                animator.SetBool(_reservedAnimation, false);
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
