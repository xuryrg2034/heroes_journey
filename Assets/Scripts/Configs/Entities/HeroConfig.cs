using Interfaces;
using UnityEngine;
namespace Configs.Entities
{
    [CreateAssetMenu(menuName = "Configs/Entities/Hero", fileName = "Hero")]
    public class HeroConfig : ScriptableObject, IBaseEntityConfig
    {
        [field: SerializeField] public int MaxHealth { get; private set; }
        
        [field: SerializeField] public int Damage { get; private set; }
        
        [field: SerializeField] public int Energy { get; private set; }
    }
}
