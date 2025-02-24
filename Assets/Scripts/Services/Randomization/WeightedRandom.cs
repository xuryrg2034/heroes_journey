using UnityEngine;

namespace Managers.Randomization
{
    public static class WeightedRandom
    {
        private static float[] _weights = { 70, 20, 10, 10, 5 };

        public static void SetWeights(float[] newWeights)
        {
            if (newWeights.Length != _weights.Length)
            {
                return;
            }

            _weights = newWeights;
        }

        public static int GetRandomWeightedNumber()
        {
            float totalWeight = 0;
            foreach (var weight in _weights)
            {
                totalWeight += weight;
            }

            var randomPoint = Random.Range(0, totalWeight);
            float currentWeightSum = 0;

            for (var i = 0; i < _weights.Length; i++)
            {
                currentWeightSum += _weights[i];
                if (randomPoint <= currentWeightSum)
                {
                    return i;
                }
            }

            return _weights.Length - 1; // Безопасный возврат, но не должен быть вызван
        }
    }
}